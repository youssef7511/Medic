import { NextRequest } from 'next/server';
import { getCurrentActor } from '@/lib/auth/session';
import { prisma } from '@/lib/db';
import { hasPermission, requireLink, ResourceNotFoundError } from '@/lib/rbac/guard';
import { decryptText } from '@/lib/crypto/envelope';

/**
 * SSE endpoint for live message updates (§7).
 *
 * Client opens: GET /api/messages/stream?threadId=xxx&since=ISO
 * Server streams new messages as they arrive. Uses long-polling with a
 * 30-second timeout — if no new messages, responds with an empty heartbeat.
 *
 * This is deliberately simple: no WebSocket infrastructure, no external
 * dependencies. The client polls this endpoint every few seconds when the
 * thread view is open.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const threadId = searchParams.get('threadId');
  const sinceParam = searchParams.get('since');

  if (!threadId) {
    return new Response('Missing threadId', { status: 400 });
  }

  const actor = await getCurrentActor();
  if (!actor) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Verify the actor is on this thread's link.
  const thread = await prisma.messageThread.findUnique({
    where: { id: threadId },
    select: { id: true, linkId: true },
  });
  if (!thread) {
    return new Response('Not found', { status: 404 });
  }

  try {
    const permission = hasPermission(actor, 'message:read:clinical')
      ? 'message:read:clinical'
      : 'message:read:own';
    await requireLink(actor, thread.linkId, permission);
  } catch (e) {
    if (e instanceof ResourceNotFoundError) {
      return new Response('Not found', { status: 404 });
    }
    throw e;
  }

  const since = sinceParam ? new Date(sinceParam) : new Date(0);

  // Set up SSE response.
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // Send initial heartbeat.
      controller.enqueue(encoder.encode(': heartbeat\n\n'));

      // Poll for new messages every 2 seconds, up to 30 seconds.
      for (let i = 0; i < 15; i++) {
        const newMessages = await prisma.message.findMany({
          where: {
            threadId,
            createdAt: { gt: since },
          },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            bodyEnc: true,
            senderUserId: true,
            createdAt: true,
          },
        });

        if (newMessages.length > 0) {
          for (const msg of newMessages) {
            const data = JSON.stringify({
              id: msg.id,
              body: decryptText(msg.bodyEnc),
              senderUserId: msg.senderUserId,
              isOwn: msg.senderUserId === actor.userId,
              createdAt: msg.createdAt.toISOString(),
            });
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          }
          // Client should reconnect with the latest timestamp.
          controller.close();
          return;
        }

        // Wait 2 seconds before next poll.
        await new Promise((resolve) => setTimeout(resolve, 2000));
        controller.enqueue(encoder.encode(': heartbeat\n\n'));
      }

      // 30 seconds elapsed — close so the client can reconnect.
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

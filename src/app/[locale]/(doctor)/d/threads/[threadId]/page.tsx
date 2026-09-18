import { notFound, redirect } from 'next/navigation';
import { getCurrentActor } from '@/lib/auth/session';
import { ResourceNotFoundError } from '@/lib/rbac/guard';
import { getThread } from '@/lib/messaging/threads';
import { Link } from '@/i18n/navigation';
import { MessageForm } from './MessageForm';

export const dynamic = 'force-dynamic';

/**
 * Thread detail — shared by doctor and patient (§7). Shows the full message
 * history in chronological order, with the most recent at the bottom.
 *
 * Messages from the current user are right-aligned; messages from the other
 * party are left-aligned. Unread messages from the other party are marked as
 * read on open (§7).
 *
 * §5: the permission check is role-dependent:
 * - DOCTOR: message:read:clinical
 * - PATIENT: message:read:own
 */
export default async function ThreadDetailPage({
  params,
}: {
  params: Promise<{ threadId: string; locale: string }>;
}) {
  const { threadId, locale } = await params;
  const ar = locale === 'ar';

  const actor = await getCurrentActor();
  if (!actor) redirect(`/${locale}/login`);

  let thread, messages;
  try {
    const result = await getThread(actor, threadId);
    thread = result.thread;
    messages = result.messages;
  } catch (e) {
    if (e instanceof ResourceNotFoundError) notFound();
    throw e;
  }

  return (
    <section className="flex h-[calc(100vh-4rem)] flex-col">
      {/* Header */}
      <div className="border-b border-gray-200 bg-white px-4 py-3">
        <Link
          href="/d/threads"
          className="text-xs text-brand-600 hover:underline"
        >
          {ar ? 'المحادثات' : 'Conversations'}
        </Link>
        <h1 className="mt-1 text-lg font-bold">
          {thread.subject ?? (ar ? 'محادثة' : 'Conversation')}
        </h1>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <p className="text-center text-sm text-gray-500">
            {ar
              ? 'ابدأ المحادثة بكتابة رسالة.'
              : 'Commencez la conversation en écrivant un message.'}
          </p>
        )}

        <div className="space-y-3">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.isOwn ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-xs rounded-lg px-4 py-2 text-sm ${
                  msg.isOwn
                    ? 'bg-brand-500 text-white'
                    : 'bg-gray-100 text-gray-900'
                }`}
              >
                <p dir="auto" className="whitespace-pre-wrap">
                  {msg.body}
                </p>
                <p
                  className={`mt-1 text-xs ${
                    msg.isOwn ? 'text-brand-100' : 'text-gray-400'
                  }`}
                >
                  {msg.createdAt.toLocaleTimeString(locale, {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Compose */}
      <MessageForm threadId={threadId} locale={locale} />
    </section>
  );
}

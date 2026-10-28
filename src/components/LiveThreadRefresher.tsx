'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Live thread updates (§7). Opens the SSE endpoint for the open thread and
 * refreshes the server-rendered message list whenever a new message arrives,
 * so conversations update without a manual reload.
 *
 * The stream endpoint closes after delivering messages (or a 30s heartbeat),
 * and EventSource reconnects automatically. Recreating the connection with the
 * newest message timestamp keeps the `since` cursor moving so messages aren't
 * re-fetched.
 */
export function LiveThreadRefresher({
  threadId,
  since,
}: {
  threadId: string;
  since: string | null;
}) {
  const router = useRouter();

  useEffect(() => {
    const cursor =
      since != null
        ? new Date(new Date(since).getTime() - 1).toISOString()
        : new Date(0).toISOString();
    const es = new EventSource(
      `/api/messages/stream?threadId=${encodeURIComponent(threadId)}&since=${encodeURIComponent(cursor)}`,
    );

    es.onmessage = () => router.refresh();

    return () => es.close();
  }, [threadId, since, router]);

  return null;
}

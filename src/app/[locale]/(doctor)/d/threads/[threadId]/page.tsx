import { notFound, redirect } from 'next/navigation';
import { getCurrentActor } from '@/lib/auth/session';
import { ResourceNotFoundError } from '@/lib/rbac/guard';
import { threadParticipants } from '@/lib/messaging/e2ee-server';
import { SecureConversation } from '@/components/SecureConversation';
export const dynamic = 'force-dynamic';
export default async function ThreadPage({ params }: { params: Promise<{ threadId: string; locale: string }> }) {
  const { threadId, locale } = await params;
  const actor = await getCurrentActor();
  if (!actor) redirect(`/${locale}/login`);
  try {
    const context = await threadParticipants(actor, threadId, locale);
    return <SecureConversation threadId={context.threadId} locale={locale} backHref={"/d/threads"} />;
  } catch (error) { if (error instanceof ResourceNotFoundError) notFound(); throw error; }
}

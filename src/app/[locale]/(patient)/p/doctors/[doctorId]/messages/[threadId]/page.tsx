import { notFound, redirect } from 'next/navigation';
import { getCurrentActor } from '@/lib/auth/session';
import { ResourceNotFoundError } from '@/lib/rbac/guard';
import { getThread } from '@/lib/messaging/threads';
import { Link } from '@/i18n/navigation';
import { MessageForm } from './MessageForm';

export const dynamic = 'force-dynamic';

/**
 * Patient's thread detail (§7). Same message view as the doctor side, but
 * the compose form posts to the patient-specific server action.
 */
export default async function PatientThreadDetailPage({
  params,
}: {
  params: Promise<{ doctorId: string; threadId: string; locale: string }>;
}) {
  const { doctorId, threadId, locale } = await params;
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
    <section className="medic-panel flex h-[calc(100vh-11rem)] min-h-[560px] flex-col">
      {/* Header */}
      <div className="border-b border-slate-100 bg-white px-5 py-4">
        <Link
          href={`/p/doctors/${doctorId}/messages`}
          className="text-xs font-semibold text-brand-700 hover:underline"
        >
          {ar ? 'الرسائل' : 'Messages'}
        </Link>
        <h1 className="mt-1 text-lg font-bold text-navy-950">
          {thread.subject ?? (ar ? 'محادثة' : 'Conversation')}
        </h1>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto bg-slate-50/70 px-4 py-5 sm:px-6">
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
                className={`max-w-[82%] rounded-2xl px-4 py-2.5 text-sm shadow-sm sm:max-w-md ${
                  msg.isOwn
                    ? 'rounded-ee-sm bg-brand-600 text-white'
                    : 'rounded-es-sm border border-slate-200 bg-white text-slate-900'
                }`}
              >
                <p dir="auto" className="whitespace-pre-wrap">
                  {msg.body}
                </p>
                <p
                  className={`mt-1 text-xs ${
                    msg.isOwn ? 'text-brand-100' : 'text-slate-400'
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
      <MessageForm threadId={threadId} doctorId={doctorId} locale={locale} />
    </section>
  );
}

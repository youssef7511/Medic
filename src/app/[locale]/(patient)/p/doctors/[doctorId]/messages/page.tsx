import { notFound, redirect } from 'next/navigation';
import { getCurrentActor } from '@/lib/auth/session';
import { prisma } from '@/lib/db';
import { listPatientThreads } from '@/lib/messaging/threads';
import { Link } from '@/i18n/navigation';
import { MessageSquare } from 'lucide-react';

export const dynamic = 'force-dynamic';

/**
 * Patient's thread list for one doctor (§7). The route carries a doctorId
 * (the per-doctor space), so we resolve THIS patient's link to that doctor
 * and filter threads to only that link.
 *
 * Shows the last message preview, unread count, and timestamp.
 */
export default async function PatientMessagesPage({
  params,
}: {
  params: Promise<{ doctorId: string; locale: string }>;
}) {
  const { doctorId, locale } = await params;
  const ar = locale === 'ar';

  const actor = await getCurrentActor();
  if (!actor) redirect(`/${locale}/login`);

  // Resolve the link.
  const profile = await prisma.patientProfile.findUnique({
    where: { userId: actor.userId },
    select: { id: true },
  });
  if (!profile) notFound();

  const link = await prisma.patientDoctorLink.findUnique({
    where: { patientId_doctorId: { patientId: profile.id, doctorId } },
    select: { id: true },
  });
  if (!link) notFound();

  // Get all threads for this patient, then filter to this doctor's link.
  const allThreads = await listPatientThreads(actor, locale);
  const threads = allThreads.filter((t) => t.linkId === link.id);

  return (
    <section>
      <h1 className="mb-6 text-2xl font-bold">
        {ar ? 'الرسائل' : 'Messages'}
      </h1>

      {threads.length === 0 ? (
        <div className="text-center">
          <MessageSquare className="mx-auto h-12 w-12 text-gray-300" />
          <p className="mt-3 text-sm text-gray-500">
            {ar
              ? 'لم تبدأ المحادثة بعد.'
              : 'Vous n\'avez pas encore de conversation.'}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
          {threads.map((thread) => (
            <li key={thread.id}>
              <Link
                href={`/p/doctors/${doctorId}/messages/${thread.id}`}
                className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-gray-50"
              >
                <div className="flex items-center gap-3">
                  <MessageSquare className="h-5 w-5 shrink-0 text-gray-400" />
                  <div>
                    <p className="text-sm font-medium">
                      {thread.subject ?? (ar ? 'محادثة' : 'Conversation')}
                    </p>
                    {thread.lastMessagePreview && (
                      <p className="mt-0.5 truncate text-xs text-gray-500 max-w-xs">
                        {thread.lastMessagePreview}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {thread.lastMessageAt && (
                    <time className="text-xs text-gray-400">
                      {thread.lastMessageAt.toLocaleDateString(locale, {
                        day: 'numeric',
                        month: 'short',
                      })}
                    </time>
                  )}
                  {thread.unreadCount > 0 && (
                    <span className="rounded-full bg-brand-500 px-2 py-0.5 text-xs font-medium text-white">
                      {thread.unreadCount}
                    </span>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

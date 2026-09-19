import { notFound, redirect } from 'next/navigation';
import { getCurrentActor } from '@/lib/auth/session';
import { prisma } from '@/lib/db';
import { listPatientThreads } from '@/lib/messaging/threads';
import { Link } from '@/i18n/navigation';
import { ArrowRight, MessageSquare, ShieldCheck } from 'lucide-react';

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
      <div><p className="medic-kicker">{ar ? 'تواصل آمن' : 'Communication sécurisée'}</p><h1 className="medic-page-title mt-2">{ar ? 'الرسائل' : 'Messages'}</h1><p className="mt-2 text-sm text-slate-500">{ar ? 'تواصل مع فريق الرعاية خارج حالات الطوارئ.' : 'Échangez avec votre équipe de soin hors situations d’urgence.'}</p></div>

      {threads.length === 0 ? (
        <div className="medic-panel mt-6 p-10 text-center">
          <MessageSquare className="mx-auto h-12 w-12 text-slate-300" />
          <p className="mt-3 text-sm text-slate-500">
            {ar
              ? 'لم تبدأ المحادثة بعد.'
              : 'Vous n\'avez pas encore de conversation.'}
          </p>
        </div>
      ) : (
        <ul className="medic-panel mt-6 divide-y divide-slate-100">
          {threads.map((thread) => (
            <li key={thread.id}>
              <Link
                href={`/p/doctors/${doctorId}/messages/${thread.id}`}
                className="group flex items-center justify-between gap-4 px-5 py-4 hover:bg-slate-50"
              >
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700"><MessageSquare className="h-5 w-5" /></span>
                  <div>
                    <p className="text-sm font-bold text-navy-950">
                      {thread.subject ?? (ar ? 'محادثة' : 'Conversation')}
                    </p>
                    {thread.lastMessagePreview && (
                      <p className="mt-1 max-w-xs truncate text-xs text-slate-500">
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
                  {thread.unreadCount > 0 ? (
                    <span className="rounded-full bg-brand-500 px-2 py-0.5 text-xs font-medium text-white">
                      {thread.unreadCount}
                    </span>
                  ) : <ArrowRight className="h-4 w-4 text-slate-300 group-hover:text-brand-600 rtl:rotate-180" />}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-5 flex items-start gap-2 text-xs leading-5 text-slate-500"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />{ar ? 'الرسائل مشفرة ومحدودة بعلاقة الرعاية النشطة.' : 'Les messages sont chiffrés et limités à la relation de soin active.'}</p>
    </section>
  );
}

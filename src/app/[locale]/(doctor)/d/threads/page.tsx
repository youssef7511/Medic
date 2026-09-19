import { notFound, redirect } from 'next/navigation';
import { getCurrentActor } from '@/lib/auth/session';
import { hasPermission } from '@/lib/rbac/guard';
import { listDoctorThreads } from '@/lib/messaging/threads';
import { Link } from '@/i18n/navigation';
import { ArrowRight, MessageSquare } from 'lucide-react';

export const dynamic = 'force-dynamic';

/**
 * Doctor's thread list — all conversations across all patients (§7).
 * §5: only DOCTOR can see this page — DOCTOR_STAFF lacks message permissions.
 *
 * One thread per PatientDoctorLink. Shows patient name, last message preview,
 * unread count, and last message timestamp.
 */
export default async function DoctorThreadsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const ar = locale === 'ar';

  const actor = await getCurrentActor();
  if (!actor) redirect(`/${locale}/login`);
  if (!hasPermission(actor, 'message:read:clinical')) notFound();

  const threads = await listDoctorThreads(actor, locale);

  return (
    <section>
      <div><p className="medic-kicker">{ar ? 'متابعة المرضى' : 'Suivi des patients'}</p><h1 className="medic-page-title mt-2">{ar ? 'المحادثات' : 'Conversations'}</h1><p className="mt-2 text-sm text-slate-500">{ar ? 'الرسائل السريرية الآمنة مع مرضاك.' : 'Messagerie clinique sécurisée avec vos patients.'}</p></div>

      {threads.length === 0 ? (
        <div className="medic-panel mt-6 p-10 text-center"><MessageSquare className="mx-auto h-10 w-10 text-slate-300" /><p className="mt-4 text-sm text-slate-500">{ar ? 'لا توجد محادثات بعد.' : 'Aucune conversation pour le moment.'}</p></div>
      ) : (
        <ul className="medic-panel mt-6 divide-y divide-slate-100">
          {threads.map((thread) => (
            <li key={thread.id}>
              <Link
                href={`/d/threads/${thread.id}`}
                className="group flex items-center justify-between gap-4 px-5 py-4 hover:bg-slate-50"
              >
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700"><MessageSquare className="h-5 w-5" /></span>
                  <div>
                    <p className="text-sm font-bold text-navy-950">{thread.patientName}</p>
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
    </section>
  );
}

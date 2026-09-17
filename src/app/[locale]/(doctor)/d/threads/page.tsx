import { notFound, redirect } from 'next/navigation';
import { getCurrentActor } from '@/lib/auth/session';
import { hasPermission } from '@/lib/rbac/guard';
import { listDoctorThreads } from '@/lib/messaging/threads';
import { Link } from '@/i18n/navigation';
import { MessageSquare } from 'lucide-react';

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
      <h1 className="mb-6 text-2xl font-bold">
        {ar ? 'المحادثات' : 'Conversations'}
      </h1>

      {threads.length === 0 ? (
        <p className="text-sm text-gray-500">
          {ar ? 'لا توجد محادثات بعد.' : 'Aucune conversation pour le moment.'}
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
          {threads.map((thread) => (
            <li key={thread.id}>
              <Link
                href={`/d/threads/${thread.id}`}
                className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-gray-50"
              >
                <div className="flex items-center gap-3">
                  <MessageSquare className="h-5 w-5 shrink-0 text-gray-400" />
                  <div>
                    <p className="text-sm font-medium">{thread.patientName}</p>
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

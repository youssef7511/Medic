import { notFound, redirect } from 'next/navigation';
import { getCurrentActor } from '@/lib/auth/session';
import { hasPermission, ResourceNotFoundError } from '@/lib/rbac/guard';
import { getJournal } from '@/lib/clinical/notes';
import { Link } from '@/i18n/navigation';
import { NotesJournal, type JournalNote } from './NotesJournal';

export const dynamic = 'force-dynamic';

/**
 * The consultation-notes journal for one patient-doctor link (§2).
 *
 * DOCTOR_STAFF holds no note:* permission, so they never reach this page —
 * they'd fail the hasPermission gate here and, even if they URL-hacked past it,
 * getJournal's requireLink would 404. Clinical content is DOCTOR-only (§5).
 */
export default async function NotesPage({
  params,
  searchParams,
}: {
  params: Promise<{ linkId: string; locale: string }>;
  searchParams: Promise<{ retracted?: string }>;
}) {
  const { linkId, locale } = await params;
  const { retracted } = await searchParams;
  const ar = locale === 'ar';

  const actor = await getCurrentActor();
  if (!actor) redirect(`/${locale}/login`);

  // A staff account can view the calendar but never clinical notes (§5).
  if (!hasPermission(actor, 'note:read')) notFound();

  const showRetracted = retracted === '1';

  let notes: JournalNote[];
  try {
    const journal = await getJournal(actor, linkId, { includeRetracted: showRetracted });
    notes = journal.map((n) => ({
      id: n.id,
      content: n.content,
      status: n.status,
      retractReason: n.retractReason,
      createdAt: n.createdAt.toISOString(),
      updatedAt: n.updatedAt.toISOString(),
      revisionCount: n.revisionCount,
    }));
  } catch (e) {
    if (e instanceof ResourceNotFoundError) notFound();
    throw e;
  }

  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{ar ? 'الملاحظات السريرية' : 'Notes cliniques'}</h1>
        <Link
          href={`/d/patients/${linkId}/notes${showRetracted ? '' : '?retracted=1'}`}
          className="text-sm text-gray-500 hover:text-brand-600"
        >
          {showRetracted
            ? ar
              ? 'إخفاء المسحوبة'
              : 'Masquer les rétractées'
            : ar
              ? 'إظهار المسحوبة'
              : 'Afficher les rétractées'}
        </Link>
      </div>

      <p className="mb-6 text-sm text-gray-500">
        {ar
          ? 'خاصة بك — لا يراها طبيب آخر ولا الإدارة.'
          : "Privées : aucun autre médecin ni l'administration ne les voit."}
      </p>

      <NotesJournal linkId={linkId} notes={notes} showRetracted={showRetracted} />
    </section>
  );
}

import { notFound } from 'next/navigation';
import { getCurrentActor } from '@/lib/auth/session';
import { hasPermission, requireLink, ResourceNotFoundError } from '@/lib/rbac/guard';
import { Link } from '@/i18n/navigation';

export const dynamic = 'force-dynamic';

// The reference pattern for EVERY link-scoped page (§5). The route carries a
// [linkId], never a [patientId] — and requireLink proves this actor stands on
// this link before a single field is read. Out-of-scope → notFound() (404),
// never a 403 that would confirm the link exists.
export default async function DoctorPatientPage({
  params,
}: {
  params: Promise<{ linkId: string; locale: string }>;
}) {
  const { linkId, locale } = await params;
  const ar = locale === 'ar';

  const actor = await getCurrentActor();
  if (!actor) notFound();

  try {
    // 'note:read' resolves both questions: role grants it AND actor is on the link.
    await requireLink(actor, linkId, 'note:read');
  } catch (e) {
    if (e instanceof ResourceNotFoundError) notFound();
    throw e;
  }

  // Staff reach the patient page but never clinical surfaces (§5), so the link
  // is hidden rather than shown-and-404ing.
  const canReadNotes = hasPermission(actor, 'note:read');

  return (
    <section>
      <h1 className="text-2xl font-bold">Patient</h1>
      <p className="mt-2 text-sm text-gray-400">linkId: {linkId}</p>

      {canReadNotes && (
        <div className="mt-6 flex gap-3">
          <Link
            href={`/d/patients/${linkId}/notes`}
            className="inline-block rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
          >
            {ar ? 'الملاحظات السريرية' : 'Notes cliniques'}
          </Link>
          <Link
            href={`/d/patients/${linkId}/documents`}
            className="inline-block rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            {ar ? 'المستندات' : 'Documents'}
          </Link>
        </div>
      )}

      <p className="mt-6 text-gray-500">
        {ar
          ? 'المواعيد والمستندات والرسائل ستظهر هنا.'
          : 'Rendez-vous, documents et messages apparaîtront ici.'}
      </p>
    </section>
  );
}

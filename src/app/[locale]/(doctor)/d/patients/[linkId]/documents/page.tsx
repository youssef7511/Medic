import { notFound, redirect } from 'next/navigation';
import { getCurrentActor } from '@/lib/auth/session';
import { hasPermission, ResourceNotFoundError } from '@/lib/rbac/guard';
import { listDocuments } from '@/lib/documents/prescriptions';
import { Link } from '@/i18n/navigation';
import { DocumentList, type DocumentRow } from '@/components/DocumentList';
import { RevokeDocumentButton } from './RevokeDocumentButton';

export const dynamic = 'force-dynamic';

export default async function DoctorDocumentsPage({
  params,
}: {
  params: Promise<{ linkId: string; locale: string }>;
}) {
  const { linkId, locale } = await params;
  const ar = locale === 'ar';

  const actor = await getCurrentActor();
  if (!actor) redirect(`/${locale}/login`);
  if (!hasPermission(actor, 'document:read')) notFound();

  let docs;
  try {
    docs = await listDocuments(actor, linkId, locale);
  } catch (e) {
    if (e instanceof ResourceNotFoundError) notFound();
    throw e;
  }

  const rows: DocumentRow[] = docs.map((d) => ({
    id: d.id,
    type: d.type,
    status: d.status,
    version: d.version,
    issuedAtIso: d.issuedAt.toISOString(),
    medicationSummary: d.medicationSummary,
    revokeReason: d.revokeReason,
  }));

  return (
    <section>
      <div className="mb-6 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{ar ? 'المستندات' : 'Documents'}</h1>
        <Link
          href={`/d/patients/${linkId}/prescribe`}
          className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
        >
          {ar ? 'وصفة جديدة' : 'Nouvelle ordonnance'}
        </Link>
      </div>

      <DocumentList
        documents={rows}
        locale={locale}
        actions={(doc) =>
          doc.status === 'ACTIVE' ? (
            <RevokeDocumentButton linkId={linkId} documentId={doc.id} />
          ) : null
        }
      />
    </section>
  );
}

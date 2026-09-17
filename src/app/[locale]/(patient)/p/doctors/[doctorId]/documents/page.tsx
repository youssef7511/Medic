import { notFound, redirect } from 'next/navigation';
import { getCurrentActor } from '@/lib/auth/session';
import { ResourceNotFoundError } from '@/lib/rbac/guard';
import { prisma } from '@/lib/db';
import { listDocuments } from '@/lib/documents/prescriptions';
import { DocumentList, type DocumentRow } from '@/components/DocumentList';
import { ShareDocumentButton } from './ShareDocumentButton';
import { getDocumentShares } from '@/lib/documents/sharing';

export const dynamic = 'force-dynamic';

/**
 * The patient's document timeline for one doctor. The route carries a doctorId
 * (the per-doctor space), so we resolve THIS patient's link to that doctor and
 * hand listDocuments the linkId — the guard still proves ownership.
 *
 * §4c: ACTIVE documents show a Share button. Shared documents show a badge
 * with the target doctor's name and a Revoke control.
 */
export default async function PatientDocumentsPage({
  params,
}: {
  params: Promise<{ doctorId: string; locale: string }>;
}) {
  const { doctorId, locale } = await params;
  const ar = locale === 'ar';

  const actor = await getCurrentActor();
  if (!actor) redirect(`/${locale}/login`);

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

  let docs;
  try {
    docs = await listDocuments(actor, link.id, locale);
  } catch (e) {
    if (e instanceof ResourceNotFoundError) notFound();
    throw e;
  }

  // Batch-load share status for all documents on this link (§4c).
  const shareMap = await getDocumentShares(
    actor,
    link.id,
    docs.map((d) => d.id),
  );

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
      <h1 className="mb-6 text-2xl font-bold">{ar ? 'مستنداتي' : 'Mes documents'}</h1>
      <DocumentList
        documents={rows}
        locale={locale}
        actions={(doc) =>
          doc.status === 'ACTIVE' ? (
            <ShareDocumentButton
              documentId={doc.id}
              locale={locale}
              hasShare={shareMap.has(doc.id)}
              shareDoctorName={shareMap.get(doc.id)?.doctorName}
              shareId={shareMap.get(doc.id)?.id}
            />
          ) : null
        }
      />
    </section>
  );
}

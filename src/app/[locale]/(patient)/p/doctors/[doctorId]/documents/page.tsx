import { notFound, redirect } from 'next/navigation';
import { getCurrentActor } from '@/lib/auth/session';
import { ResourceNotFoundError } from '@/lib/rbac/guard';
import { prisma } from '@/lib/db';
import { listDocuments } from '@/lib/documents/prescriptions';
import { DocumentList, type DocumentRow } from '@/components/DocumentList';

export const dynamic = 'force-dynamic';

/**
 * The patient's document timeline for one doctor. The route carries a doctorId
 * (the per-doctor space), so we resolve THIS patient's link to that doctor and
 * hand listDocuments the linkId — the guard still proves ownership.
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
      <DocumentList documents={rows} locale={locale} />
    </section>
  );
}

import { notFound, redirect } from 'next/navigation';
import { getCurrentActor } from '@/lib/auth/session';
import { ResourceNotFoundError } from '@/lib/rbac/guard';
import { prisma } from '@/lib/db';
import { listDocuments } from '@/lib/documents/prescriptions';
import { DocumentList, type DocumentRow } from '@/components/DocumentList';
import { ShareDocumentButton } from './ShareDocumentButton';
import { getDocumentShares } from '@/lib/documents/sharing';
import { ShieldCheck } from 'lucide-react';

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
      <div><p className="medic-kicker">{ar ? 'الملف الطبي' : 'Dossier médical'}</p><h1 className="medic-page-title mt-2">{ar ? 'مستنداتي' : 'Mes documents'}</h1><p className="mt-2 text-sm text-slate-500">{ar ? 'اعرض وصفاتك وشاركها بشكل آمن.' : 'Consultez vos documents et partagez-les de manière sécurisée.'}</p></div>
      <div className="mt-6 flex items-start gap-3 rounded-2xl border border-brand-200 bg-brand-50 p-4"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-700" /><div><p className="text-sm font-semibold text-navy-950">{ar ? 'المشاركة تحت سيطرتك' : 'Vous gardez le contrôle du partage'}</p><p className="mt-1 text-xs leading-5 text-slate-600">{ar ? 'يتم تثبيت المشاركة على نسخة محددة ويمكنك إلغاؤها.' : 'Le partage porte sur une version précise et peut être révoqué.'}</p></div></div>
      <div className="mt-5"><DocumentList
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
      /></div>
    </section>
  );
}

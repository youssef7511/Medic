import { notFound, redirect } from 'next/navigation';
import { getCurrentActor } from '@/lib/auth/session';
import { hasPermission, requireLink, ResourceNotFoundError } from '@/lib/rbac/guard';
import { prisma } from '@/lib/db';
import { readAllergyState } from '@/lib/clinical/allergies';
import { AllergyPanel } from '@/components/AllergyPanel';
import { PrescribeForm } from './PrescribeForm';
import { FilePlus2 } from 'lucide-react';

export const dynamic = 'force-dynamic';

/**
 * Prescribing screen (§3.1, §8). DOCTOR only — DOCTOR_STAFF lacks
 * `document:issue`, so they 404 here and cannot reach clinical issuance (§5).
 */
export default async function PrescribePage({
  params,
}: {
  params: Promise<{ linkId: string; locale: string }>;
}) {
  const { linkId, locale } = await params;
  const ar = locale === 'ar';

  const actor = await getCurrentActor();
  if (!actor) redirect(`/${locale}/login`);
  if (!hasPermission(actor, 'document:issue')) notFound();

  let patientId: string;
  try {
    const link = await requireLink(actor, linkId, 'document:issue');
    patientId = link.patientId;
  } catch (e) {
    if (e instanceof ResourceNotFoundError) notFound();
    throw e;
  }

  const [patient, allergyState] = await Promise.all([
    prisma.patientProfile.findUniqueOrThrow({
      where: { id: patientId },
      select: { firstName: true, lastName: true },
    }),
    readAllergyState(patientId),
  ]);

  return (
    <section className="max-w-4xl">
      <div><p className="medic-kicker">{ar ? 'مستند سريري' : 'Document clinique'}</p><h1 className="medic-page-title mt-2">{ar ? 'وصفة جديدة' : 'Nouvelle ordonnance'}</h1><p className="mt-2 text-sm text-slate-500">{patient.firstName} {patient.lastName}</p></div>

      {/* Allergies first, always visible before any medication is entered. */}
      <div className="mb-5 mt-6">
        <AllergyPanel state={allergyState} locale={locale} />
      </div>

      <div className="medic-panel overflow-hidden"><div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4"><span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700"><FilePlus2 className="h-5 w-5" /></span><div><h2 className="text-sm font-bold text-navy-950">{ar ? 'العلاجات والتعليمات' : 'Traitements et instructions'}</h2><p className="mt-0.5 text-xs text-slate-500">{ar ? 'سيتم إنشاء ملف PDF غير قابل للتعديل.' : 'Un PDF immuable sera généré après validation.'}</p></div></div><div className="p-5 sm:p-6"><PrescribeForm linkId={linkId} allergyRecorded={allergyState.kind !== 'not_recorded'} /></div></div>
    </section>
  );
}

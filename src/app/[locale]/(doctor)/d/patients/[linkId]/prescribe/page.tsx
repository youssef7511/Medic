import { notFound, redirect } from 'next/navigation';
import { getCurrentActor } from '@/lib/auth/session';
import { hasPermission, requireLink, ResourceNotFoundError } from '@/lib/rbac/guard';
import { prisma } from '@/lib/db';
import { readAllergyState } from '@/lib/clinical/allergies';
import { AllergyPanel } from '@/components/AllergyPanel';
import { PrescribeForm } from './PrescribeForm';

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
    <section className="max-w-3xl">
      <h1 className="text-2xl font-bold">{ar ? 'وصفة جديدة' : 'Nouvelle ordonnance'}</h1>
      <p className="mb-6 mt-1 text-sm text-gray-500">
        {patient.firstName} {patient.lastName}
      </p>

      {/* Allergies first, always visible before any medication is entered. */}
      <div className="mb-6">
        <AllergyPanel state={allergyState} locale={locale} />
      </div>

      <PrescribeForm linkId={linkId} allergyRecorded={allergyState.kind !== 'not_recorded'} />
    </section>
  );
}

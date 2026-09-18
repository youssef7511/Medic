import { redirect } from 'next/navigation';
import { getCurrentActor } from '@/lib/auth/session';
import { prisma } from '@/lib/db';
import { decryptText } from '@/lib/crypto/envelope';
import { AllergyForm } from './AllergyForm';

export const dynamic = 'force-dynamic';

export default async function AllergiesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const ar = locale === 'ar';

  const actor = await getCurrentActor();
  if (!actor) redirect(`/${locale}/login`);

  const profile = await prisma.patientProfile.findUnique({
    where: { userId: actor.userId },
    select: { allergiesEnc: true, allergiesAffirmedNone: true },
  });

  const initialText = profile?.allergiesEnc ? await decryptText(profile.allergiesEnc) : '';

  return (
    <section className="max-w-xl">
      <h1 className="text-2xl font-bold">{ar ? 'الحساسيات الدوائية' : 'Allergies médicamenteuses'}</h1>
      <p className="mb-6 mt-1 text-sm text-gray-500">
        {ar
          ? 'تظهر هذه المعلومة لطبيبك عند وصف الدواء.'
          : 'Cette information est affichée à votre médecin lors de la prescription.'}
      </p>
      <AllergyForm initialText={initialText} initialAffirmedNone={profile?.allergiesAffirmedNone ?? false} />
    </section>
  );
}

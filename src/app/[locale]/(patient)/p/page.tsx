import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getCurrentActor } from '@/lib/auth/session';
import { prisma } from '@/lib/db';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/config';

export const dynamic = 'force-dynamic';

// Patient hub (§4): "all my doctors". Lists the patient's ACTIVE links, each
// linking into the per-doctor space (book / documents).
export default async function PatientHubPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const ar = locale === 'ar';
  const t = await getTranslations();

  const actor = await getCurrentActor();
  if (!actor) redirect(`/${locale}/login`);

  const profile = await prisma.patientProfile.findUnique({
    where: { userId: actor.userId },
    select: {
      links: {
        where: { status: 'ACTIVE' },
        select: {
          doctor: { select: { id: true, headline: true, specialty: { select: { name: true } } } },
        },
      },
    },
  });

  const doctors = profile?.links ?? [];

  return (
    <section>
      <h1 className="text-2xl font-bold">{t('nav.myDoctors')}</h1>

      {doctors.length === 0 ? (
        <p className="mt-6 text-gray-500">
          {ar ? 'لا يوجد أطباء مرتبطون بعد.' : 'Aucun médecin lié pour le moment.'}
        </p>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">
          {doctors.map(({ doctor }) => {
            const name = (doctor.headline as Record<Locale, string>)?.[locale as Locale] ?? '';
            const specialty =
              (doctor.specialty.name as Record<Locale, string>)?.[locale as Locale] ?? '';
            return (
              <li key={doctor.id} className="rounded-lg border border-gray-200 bg-white p-4">
                <p className="font-medium">{name}</p>
                <p className="text-sm text-gray-500">{specialty}</p>
                <div className="mt-3 flex gap-3 text-sm">
                  <Link href={`/p/doctors/${doctor.id}/book`} className="text-brand-600 hover:underline">
                    {t('common.book')}
                  </Link>
                   <Link
                    href={`/p/doctors/${doctor.id}/documents`}
                    className="text-brand-600 hover:underline"
                  >
                    {ar ? 'المستندات' : 'Documents'}
                  </Link>
                  <Link
                    href={`/p/doctors/${doctor.id}/messages`}
                    className="text-brand-600 hover:underline"
                  >
                    {ar ? 'الرسائل' : 'Messages'}
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

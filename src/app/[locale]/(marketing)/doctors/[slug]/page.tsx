import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { prisma } from '@/lib/db';
import { getCurrentActor } from '@/lib/auth/session';
import type { Locale } from '@/i18n/config';

export const dynamic = 'force-dynamic';

async function getDoctor(slug: string) {
  try {
    return await prisma.doctorProfile.findFirst({
      where: { slug, isPublished: true },
      include: { specialty: true, clinics: true },
    });
  } catch {
    return null;
  }
}

// §4: profiles are SSR + indexable. Real per-doctor metadata drives SEO.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; locale: string }>;
}): Promise<Metadata> {
  const { slug, locale } = await params;
  const doctor = await getDoctor(slug);
  if (!doctor) return {};
  const headline = (doctor.headline as Record<Locale, string>)?.[locale as Locale] ?? doctor.slug;
  return { title: `${headline} — Medic`, description: headline };
}

export default async function DoctorProfilePage({
  params,
}: {
  params: Promise<{ slug: string; locale: string }>;
}) {
  const { slug, locale } = await params;
  const t = await getTranslations();
  const doctor = await getDoctor(slug);
  if (!doctor) notFound();

  const headline = (doctor.headline as Record<Locale, string>)?.[locale as Locale] ?? doctor.slug;
  const bio = (doctor.bio as Record<Locale, string>)?.[locale as Locale] ?? '';
  const specialty = (doctor.specialty.name as Record<Locale, string>)?.[locale as Locale] ?? '';

  const actor = await getCurrentActor();
  const bookPath = `/p/doctors/${doctor.id}/book`;

  return (
    <article>
      <p className="text-sm text-brand-600">{specialty}</p>
      <h1 className="mt-1 text-3xl font-bold">{headline}</h1>
      <p className="mt-4 max-w-2xl text-gray-700">{bio}</p>

      {/* §4 entry flow: unauthenticated → /login?next=… → per-doctor patient space.
          Already signed in? Link straight there. The login page would bounce them
          to the same destination anyway, so the detour only cost a redirect and
          showed a signed-in patient a "login" URL under the booking button. */}
      <Link
        href={actor ? bookPath : `/login?next=${bookPath}`}
        className="mt-8 inline-block rounded-lg bg-brand-500 px-6 py-3 font-medium text-white hover:bg-brand-600"
      >
        {t('common.book')}
      </Link>
    </article>
  );
}

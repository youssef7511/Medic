import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { prisma } from '@/lib/db';
import type { Locale } from '@/i18n/config';

// §13.6: plain Postgres query with indexed filters — no search engine at launch.
// Dynamic so build/prerender never touches the database (§10, host-agnostic).
export const dynamic = 'force-dynamic';

async function getPublishedDoctors() {
  try {
    return await prisma.doctorProfile.findMany({
      where: { isPublished: true },
      include: { specialty: true, clinics: { select: { address: true } } },
      orderBy: { createdAt: 'desc' },
      take: 60,
    });
  } catch {
    // No DB wired yet in this environment — render the empty state.
    return [];
  }
}

export default async function DoctorsDirectoryPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations();
  const doctors = await getPublishedDoctors();

  return (
    <section>
      <h1 className="text-2xl font-bold">{t('directory.title')}</h1>

      {doctors.length === 0 ? (
        <p className="mt-8 text-gray-500">{t('directory.empty')}</p>
      ) : (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {doctors.map((d) => {
            const name = (d.headline as Record<Locale, string>)?.[locale as Locale] ?? d.slug;
            const specialty =
              (d.specialty.name as Record<Locale, string>)?.[locale as Locale] ?? '';
            return (
              <li key={d.id} className="rounded-lg border border-gray-100 p-4">
                <p className="font-medium">{name}</p>
                <p className="mt-1 text-sm text-gray-500">{specialty}</p>
                <Link
                  href={`/doctors/${d.slug}`}
                  className="mt-3 inline-block text-sm font-medium text-brand-600 hover:underline"
                >
                  {t('directory.viewProfile')} →
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

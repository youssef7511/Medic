import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

export default async function LandingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  return (
    <section className="py-16 text-center">
      <h1 className="mx-auto max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl">
        {t('landing.heroTitle')}
      </h1>
      <p className="mx-auto mt-6 max-w-xl text-lg text-gray-600">
        {t('landing.heroSubtitle')}
      </p>
      <div className="mt-10">
        <Link
          href="/doctors"
          className="inline-block rounded-lg bg-brand-500 px-6 py-3 text-base font-medium text-white hover:bg-brand-600"
        >
          {t('landing.ctaBrowse')}
        </Link>
      </div>
    </section>
  );
}

import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { PublicAuthNav } from '@/components/PublicAuthNav';

// Public shell (§4). Everything under here is indexable and needs no auth (§13.3).
export default async function MarketingLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <header className="border-b border-gray-100">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <Link href="/" className="text-lg font-semibold text-brand-600">
            {t('common.appName')}
          </Link>
          <nav className="flex items-center gap-4">
            <Link href="/doctors" className="text-sm text-gray-700 hover:text-brand-600">
              {t('nav.doctors')}
            </Link>
            <PublicAuthNav />
            <LocaleSwitcher />
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-10">{children}</main>
    </div>
  );
}

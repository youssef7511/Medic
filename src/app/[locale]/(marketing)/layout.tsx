import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { PublicAuthNav } from '@/components/PublicAuthNav';
import { Brand } from '@/components/Brand';

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
    <div className="min-h-screen bg-white text-slate-900">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-[72px] max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Brand />
          <nav className="flex items-center gap-3 sm:gap-5">
            <Link href="/" className="hidden text-sm font-medium text-slate-600 hover:text-brand-700 md:block">
              {locale === 'ar' ? 'الرئيسية' : 'Accueil'}
            </Link>
            <Link href="/doctors" className="hidden text-sm font-medium text-slate-600 hover:text-brand-700 sm:block">
              {t('nav.doctors')}
            </Link>
            <LocaleSwitcher />
            <PublicAuthNav />
          </nav>
        </div>
      </header>
      <main>{children}</main>
      <footer className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-8 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <Brand compact />
          <p>{t('safety.notForEmergencies')}</p>
        </div>
      </footer>
    </div>
  );
}

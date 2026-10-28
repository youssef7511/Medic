import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Info } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { PublicAuthNav } from '@/components/PublicAuthNav';
import { Brand } from '@/components/Brand';

export default async function MarketingLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();
  const ar = locale === 'ar';
  return <div className="public-site">
    <a className="public-skip-link" href="#public-main">{ar ? 'الانتقال إلى المحتوى' : 'Aller au contenu'}</a>
    <header className="public-header"><div className="public-header-inner">
      <Brand className="public-brand" />
      <nav className="public-main-nav" aria-label={ar ? 'التنقل الرئيسي' : 'Navigation principale'}><Link href="/doctors">{t('nav.doctors')}</Link><Link href="/#comment-ca-marche">{ar ? 'كيف يعمل Medic' : 'Comment ça marche'}</Link></nav>
      <LocaleSwitcher />
      <PublicAuthNav />
    </div></header>
    <main id="public-main">{children}</main>
    <footer className="public-footer"><div className="editorial-container public-footer-inner">
      <div><Brand className="public-brand" /><p className="public-footer-tagline">{ar ? 'صحة أقرب إليك.' : 'Une santé plus proche de vous.'}</p></div>
      <nav aria-label={ar ? 'روابط مفيدة' : 'Liens utiles'}><Link href="/doctors">{t('nav.doctors')}</Link><Link href="/#comment-ca-marche">{ar ? 'كيف يعمل Medic' : 'Comment ça marche'}</Link><Link href="/login/doctor">{ar ? 'فضاء الطبيب' : 'Espace médecin'}</Link></nav>
      <p className="public-footer-safety"><Info aria-hidden="true" />{t('safety.notForEmergencies')}</p>
    </div></footer>
  </div>;
}

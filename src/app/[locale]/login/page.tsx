import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getCurrentActor } from '@/lib/auth/session';
import { defaultLandingFor, safeNextPath } from '@/lib/auth/redirects';
import { LoginForm } from './LoginForm';
import { getPlatformSettings } from '@/lib/admin/platform-settings-service';
import { Brand } from '@/components/Brand';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { CalendarCheck, LockKeyhole, ShieldCheck } from 'lucide-react';
import { Link } from '@/i18n/navigation';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const { locale } = await params;
  const { next } = await searchParams;
  const t = await getTranslations();

  // Already signed in → straight to the (validated) destination, defaulting to
  // whichever space this actor's roles actually grant.
  const actor = await getCurrentActor();
  if (actor) redirect(safeNextPath(next, locale, defaultLandingFor(actor.roles, locale)));

  const settings = await getPlatformSettings();

  return (
    <div className="grid min-h-screen bg-white lg:grid-cols-[0.9fr_1.1fr]">
      <aside className="relative hidden overflow-hidden bg-navy-950 p-10 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -end-24 top-24 h-80 w-80 rounded-full bg-brand-500/20 blur-3xl" aria-hidden />
        <Brand className="relative text-white" />
        <div className="relative max-w-lg">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-300">{locale === 'ar' ? 'صحتك، بأمان' : 'Votre santé, en toute confiance'}</p>
          <h2 className="mt-4 text-4xl font-bold leading-tight">{locale === 'ar' ? 'كل رحلة رعاية تبدأ بمساحة آمنة.' : 'Chaque parcours de soin commence par un espace sécurisé.'}</h2>
          <div className="mt-8 space-y-4">
            <TrustItem icon={ShieldCheck} text={locale === 'ar' ? 'بيانات صحية محمية' : 'Données de santé protégées'} />
            <TrustItem icon={CalendarCheck} text={locale === 'ar' ? 'مواعيدك في مكان واحد' : 'Vos rendez-vous au même endroit'} />
            <TrustItem icon={LockKeyhole} text={locale === 'ar' ? 'مصادقة قوية للحسابات الحساسة' : 'Authentification forte pour les comptes sensibles'} />
          </div>
        </div>
        <p className="relative text-xs text-slate-400">Medic · {new Date().getFullYear()}</p>
      </aside>

      <main className="flex min-h-screen flex-col">
        <header className="flex items-center justify-between px-5 py-5 sm:px-8">
          <Brand className="lg:hidden" />
          <Link href="/" className="hidden text-sm font-semibold text-slate-500 hover:text-brand-700 lg:block">← {locale === 'ar' ? 'العودة إلى الموقع' : 'Retour au site'}</Link>
          <LocaleSwitcher />
        </header>
        <div className="flex flex-1 items-center justify-center px-5 pb-12 sm:px-8">
          <div className="w-full max-w-md">
            <p className="medic-kicker">{locale === 'ar' ? 'مرحباً بعودتك' : 'Heureux de vous revoir'}</p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-navy-950">{t('common.login')}</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">{locale === 'ar' ? 'أدخل بياناتك للوصول إلى مساحتك الآمنة.' : 'Saisissez vos identifiants pour accéder à votre espace sécurisé.'}</p>
            <div className="mt-8"><LoginForm next={next} /></div>
            {(settings.supportEmail || settings.supportPhone) && (
              <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
                <p className="font-semibold text-navy-950">{locale === 'ar' ? 'هل تحتاج إلى مساعدة؟' : 'Besoin d’aide ?'}</p>
                {settings.supportEmail && <p className="mt-1">{settings.supportEmail}</p>}
                {settings.supportPhone && <p>{settings.supportPhone}</p>}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function TrustItem({ icon: Icon, text }: { icon: typeof ShieldCheck; text: string }) {
  return <div className="flex items-center gap-3 text-sm text-slate-200"><span className="grid h-10 w-10 place-items-center rounded-xl bg-white/10 text-brand-300"><Icon className="h-5 w-5" /></span>{text}</div>;
}

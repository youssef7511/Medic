import { redirect } from 'next/navigation';
import {
  CalendarCheck,
  LockKeyhole,
  ShieldCheck,
  Stethoscope,
  UserRound,
} from 'lucide-react';
import { Brand } from '@/components/Brand';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { Link } from '@/i18n/navigation';
import { getCurrentActor } from '@/lib/auth/session';
import { defaultLandingFor } from '@/lib/auth/redirects';
import { getPlatformSettings } from '@/lib/admin/platform-settings-service';
import type { LoginPortal } from '@/lib/auth/portals';
import { LoginForm } from './LoginForm';

const COPY = {
  patient: {
    fr: {
      kicker: 'Espace patient',
      title: 'Connexion patient',
      description: 'Accédez à vos rendez-vous, documents et échanges avec votre équipe de soin.',
      aside: 'Vos soins, vos documents et votre équipe dans un espace protégé.',
    },
    ar: {
      kicker: 'مساحة المريض',
      title: 'دخول المريض',
      description: 'ادخل إلى مواعيدك ووثائقك ورسائلك مع فريق الرعاية.',
      aside: 'رعايتك ووثائقك وفريقك في مساحة محمية.',
    },
  },
  doctor: {
    fr: {
      kicker: 'Espace professionnel',
      title: 'Connexion médecin',
      description: 'Accédez à votre agenda, vos patients et vos outils cliniques sécurisés.',
      aside: 'Pilotez votre activité clinique avec une authentification renforcée.',
    },
    ar: {
      kicker: 'المساحة المهنية',
      title: 'دخول الطبيب',
      description: 'ادخل إلى تقويمك ومرضاك وأدواتك السريرية الآمنة.',
      aside: 'أدر نشاطك السريري بمصادقة قوية.',
    },
  },
  admin: {
    fr: {
      kicker: 'Administration',
      title: 'Connexion administrateur',
      description: 'Accédez aux contrôles opérationnels, aux rôles et au journal d’audit.',
      aside: 'Supervisez la plateforme avec MFA et traçabilité des actions sensibles.',
    },
    ar: {
      kicker: 'الإدارة',
      title: 'دخول المسؤول',
      description: 'ادخل إلى الضوابط التشغيلية والأدوار وسجل التدقيق.',
      aside: 'أشرف على المنصة باستخدام MFA وتتبع الإجراءات الحساسة.',
    },
  },
} as const;

export async function LoginPortalShell({
  locale,
  next,
  portal,
}: {
  locale: string;
  next?: string;
  portal: LoginPortal;
}) {
  const actor = await getCurrentActor();
  if (actor) redirect(defaultLandingFor(actor.roles, locale));

  const settings = await getPlatformSettings();
  const ar = locale === 'ar';
  const copy = COPY[portal][ar ? 'ar' : 'fr'];
  const PortalIcon = portal === 'patient' ? UserRound : portal === 'doctor' ? Stethoscope : ShieldCheck;

  return (
    <div className="grid min-h-screen bg-white lg:grid-cols-[0.9fr_1.1fr]">
      <aside className="relative hidden overflow-hidden bg-navy-950 p-10 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -end-24 top-24 h-80 w-80 rounded-full bg-brand-500/20 blur-3xl" aria-hidden />
        <Brand className="relative text-white" />
        <div className="relative max-w-lg">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-white/10 text-brand-300"><PortalIcon className="h-7 w-7" /></span>
          <p className="mt-6 text-xs font-semibold uppercase tracking-[0.18em] text-brand-300">{copy.kicker}</p>
          <h2 className="mt-4 text-4xl font-bold leading-tight">{copy.aside}</h2>
          <div className="mt-8 space-y-4">
            <TrustItem icon={ShieldCheck} text={ar ? 'بيانات صحية محمية' : 'Données de santé protégées'} />
            <TrustItem icon={CalendarCheck} text={ar ? 'نشاطك في مكان واحد' : 'Votre activité au même endroit'} />
            <TrustItem icon={LockKeyhole} text={ar ? 'مصادقة قوية للحسابات الحساسة' : 'Authentification forte pour les comptes sensibles'} />
          </div>
        </div>
        <p className="relative text-xs text-slate-400">Medic · {new Date().getFullYear()}</p>
      </aside>

      <main className="flex min-h-screen flex-col">
        <header className="flex items-center justify-between px-5 py-5 sm:px-8">
          <Brand className="lg:hidden" />
          <Link href="/login" className="hidden text-sm font-semibold text-slate-500 hover:text-brand-700 lg:block">← {ar ? 'اختيار مساحة أخرى' : 'Choisir un autre espace'}</Link>
          <LocaleSwitcher />
        </header>
        <div className="flex flex-1 items-center justify-center px-5 pb-12 sm:px-8">
          <div className="w-full max-w-md">
            <p className="medic-kicker">{copy.kicker}</p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-navy-950">{copy.title}</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">{copy.description}</p>
            <div className="mt-8"><LoginForm next={next} portal={portal} /></div>
            <Link href="/login" className="mt-5 block text-center text-sm font-semibold text-brand-700 hover:underline">{ar ? 'استخدام مساحة أخرى' : 'Utiliser un autre espace'}</Link>
            {(settings.supportEmail || settings.supportPhone) && (
              <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
                <p className="font-semibold text-navy-950">{ar ? 'هل تحتاج إلى مساعدة؟' : 'Besoin d’aide ?'}</p>
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

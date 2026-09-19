import { redirect } from 'next/navigation';
import { ArrowRight, ShieldCheck, Stethoscope, UserRound } from 'lucide-react';
import { Brand } from '@/components/Brand';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { Link } from '@/i18n/navigation';
import { getCurrentActor } from '@/lib/auth/session';
import { defaultLandingFor, safeNextPath } from '@/lib/auth/redirects';
import { portalOwnsPath, type LoginPortal } from '@/lib/auth/portals';

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
  const ar = locale === 'ar';
  const actor = await getCurrentActor();
  if (actor) redirect(defaultLandingFor(actor.roles, locale));

  // A protected-space redirect already tells us which portal the visitor
  // intended to use. Invalid or external `next` values never influence this.
  if (next) {
    const safe = safeNextPath(next, locale, '__invalid__');
    const portal = (['patient', 'doctor', 'admin'] as const).find((candidate) =>
      portalOwnsPath(candidate, safe, locale),
    );
    if (portal) redirect(`/${locale}/login/${portal}?next=${encodeURIComponent(safe)}`);
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex h-[72px] max-w-6xl items-center justify-between px-4 sm:px-6"><Brand /><LocaleSwitcher /></div></header>
      <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="mx-auto max-w-2xl text-center"><p className="medic-kicker">{ar ? 'دخول آمن' : 'Connexion sécurisée'}</p><h1 className="mt-3 text-3xl font-bold tracking-tight text-navy-950 sm:text-4xl">{ar ? 'اختر مساحتك' : 'Choisissez votre espace'}</h1><p className="mt-3 text-sm leading-6 text-slate-500">{ar ? 'كل مساحة تتحقق من الدور والصلاحيات قبل إنشاء الجلسة.' : 'Chaque portail vérifie le rôle et les permissions avant de créer la session.'}</p></div>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          <PortalCard portal="patient" icon={UserRound} title={ar ? 'مريض' : 'Patient'} description={ar ? 'مواعيدي ووثائقي ورسائلي.' : 'Mes rendez-vous, documents et messages.'} cta={ar ? 'دخول المريض' : 'Connexion patient'} />
          <PortalCard portal="doctor" icon={Stethoscope} title={ar ? 'طبيب وطاقم' : 'Médecin et équipe'} description={ar ? 'التقويم والمرضى والأدوات السريرية.' : 'Agenda, patients et outils cliniques.'} cta={ar ? 'دخول الطبيب' : 'Connexion médecin'} />
          <PortalCard portal="admin" icon={ShieldCheck} title={ar ? 'إدارة' : 'Administration'} description={ar ? 'المستخدمون والتدقيق وإعدادات المنصة.' : 'Utilisateurs, audit et configuration.'} cta={ar ? 'دخول المسؤول' : 'Connexion admin'} />
        </div>
        <p className="mt-8 text-center text-xs text-slate-400">{ar ? 'لا يمكن استخدام حساب مريض في مساحة الطبيب والعكس صحيح.' : 'Un compte patient ne peut pas ouvrir le portail médecin, et inversement.'}</p>
      </main>
    </div>
  );
}

function PortalCard({
  portal,
  icon: Icon,
  title,
  description,
  cta,
}: {
  portal: LoginPortal;
  icon: typeof UserRound;
  title: string;
  description: string;
  cta: string;
}) {
  return (
    <Link href={`/login/${portal}`} className="medic-card group flex min-h-64 flex-col p-6 transition hover:-translate-y-1 hover:border-brand-200 hover:shadow-lg">
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 text-brand-700"><Icon className="h-6 w-6" /></span>
      <h2 className="mt-5 text-lg font-bold text-navy-950">{title}</h2>
      <p className="mt-2 flex-1 text-sm leading-6 text-slate-500">{description}</p>
      <span className="mt-5 flex items-center gap-2 text-sm font-semibold text-brand-700">{cta}<ArrowRight className="h-4 w-4 transition group-hover:translate-x-1 rtl:rotate-180 rtl:group-hover:-translate-x-1" /></span>
    </Link>
  );
}

import { Link } from '@/i18n/navigation';
import { getLocale } from 'next-intl/server';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { SignOutButton } from '@/components/SignOutButton';
import { AppNav, type AppNavItem } from '@/components/AppNav';
import { Brand } from '@/components/Brand';
import { ShieldCheck, Search, ArrowUpRight, HeartPulse } from 'lucide-react';
import { getCurrentActor } from '@/lib/auth/session';
import { prisma } from '@/lib/db';

export type NavItem = AppNavItem;

export async function SpaceShell({ title, home, nav = [], children }: {
  title: string; home: string; nav?: NavItem[]; children: React.ReactNode;
}) {
  const locale = await getLocale();
  const ar = locale === 'ar';
  const patient = home === '/p';
  const actor = await getCurrentActor();
  const user = actor ? await prisma.user.findUnique({ where: { id: actor.userId }, select: {
    patientProfile: { select: { firstName: true, lastName: true } },
    doctorProfile: { select: { headline: true } },
  } }) : null;
  const name = patient ? [user?.patientProfile?.firstName, user?.patientProfile?.lastName].filter(Boolean).join(' ')
    : (user?.doctorProfile?.headline as Record<string, string> | null)?.[locale] ?? title;
  const initials = name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  return (
    <div className={`medic-workspace min-h-screen text-navy-950 lg:flex ${patient ? 'patient-space' : 'practice-space'}`}>
      <aside className="medic-sidebar sticky top-0 hidden h-screen w-64 shrink-0 flex-col lg:flex">
        <div className="px-7 pb-8 pt-8">
          <Brand className={patient ? 'text-white' : ''} />
          <Link href={home} className="mt-5 block text-[10px] font-semibold uppercase tracking-[0.2em] opacity-50">{title}</Link>
        </div>
        <AppNav items={nav} />
        <div className="sidebar-bottom mx-5 mb-5 mt-8">
          <HeartPulse className="mb-3 h-8 w-8 text-brand-400" />
          <p className="text-lg font-semibold leading-snug">{ar ? 'صحتك تقرّبنا' : 'Votre santé'}<br />{!ar && 'nous rapproche.'}</p>
          <p className="mt-3 flex items-center gap-2 text-xs opacity-60"><ShieldCheck className="h-3.5 w-3.5" />{ar ? 'مساحة آمنة' : 'Votre espace sécurisé'}</p>
          <div className="mt-6 border-t border-current/10 pt-3"><SignOutButton /></div>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 border-b border-slate-200/60 bg-white/90 backdrop-blur-xl">
          <div className="flex h-20 items-center justify-between gap-4 px-4 sm:px-7 lg:px-8">
            <div className="lg:hidden"><Brand compact /></div>
            {patient ? <form action={`/${locale}/doctors`} className="hidden w-full max-w-xl items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 px-4 sm:flex">
              <Search className="h-5 w-5 shrink-0 text-slate-400" />
              <input name="q" aria-label={ar ? 'البحث عن طبيب' : 'Rechercher un médecin'} placeholder={ar ? 'ابحث عن طبيب أو تخصص…' : 'Rechercher un médecin, une spécialité…'} className="h-11 min-w-0 flex-1 border-0 bg-transparent text-sm focus:ring-0" />
            </form> : <Link href={home} className="hidden items-center gap-2 text-sm font-medium text-slate-500 sm:flex"><span className="h-2 w-2 rounded-full bg-brand-500" />{title}</Link>}
            <div className="flex shrink-0 items-center gap-3 sm:gap-5">
              <LocaleSwitcher />
              <Link href="/" aria-label={ar ? 'الموقع العام' : 'Site public'} className="hidden rounded-xl p-2 text-slate-400 hover:bg-slate-50 hover:text-brand-700 xl:block"><ArrowUpRight className="h-5 w-5" /></Link>
              <div className="flex items-center gap-3 border-s border-slate-200 ps-3 sm:ps-5">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-sky-700 to-brand-600 text-sm font-bold text-white shadow-sm">{initials || 'M'}</span>
                <div className="hidden max-w-48 sm:block"><p className="truncate text-sm font-bold">{name || title}</p><p className="mt-0.5 text-xs text-slate-400">{title}</p></div>
              </div>
              <div className="lg:hidden"><SignOutButton compact /></div>
            </div>
          </div>
          <div className="lg:hidden"><AppNav items={nav} mobile /></div>
        </header>
        <main className="mx-auto w-full max-w-[1600px] px-4 py-7 sm:px-7 lg:px-8 lg:py-9">{children}</main>
      </div>
    </div>
  );
}

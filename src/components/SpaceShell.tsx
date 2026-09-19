import { Link } from '@/i18n/navigation';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { SignOutButton } from '@/components/SignOutButton';
import { AppNav, type AppNavItem } from '@/components/AppNav';
import { Brand } from '@/components/Brand';
import { ShieldCheck } from 'lucide-react';

export type NavItem = AppNavItem;

// Shared chrome for the three authenticated spaces.
export function SpaceShell({
  title,
  home,
  nav = [],
  children,
}: {
  title: string;
  home: string;
  nav?: NavItem[];
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 lg:flex">
      <aside className="sticky top-0 hidden h-screen w-72 shrink-0 flex-col border-e border-slate-200 bg-white lg:flex">
        <div className="px-7 pb-5 pt-7">
          <Brand />
          <Link href={home} className="mt-5 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
            {title}
          </Link>
        </div>
        {nav.length > 0 && <AppNav items={nav} />}
        <div className="m-4 rounded-2xl bg-navy-950 p-4 text-white">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="h-4 w-4 text-brand-300" />
            Données protégées
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-300">
            Accès sécurisé et actions sensibles journalisées.
          </p>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/95 backdrop-blur">
          <div className="flex h-[72px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
            <div className="lg:hidden">
              <Brand />
            </div>
            <div className="hidden lg:block">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">Medic</p>
              <p className="text-sm font-semibold text-navy-950">{title}</p>
            </div>
            <div className="flex items-center gap-3">
              <Link href="/" className="hidden text-sm font-medium text-slate-500 hover:text-brand-700 sm:block">
                Site public
              </Link>
              <LocaleSwitcher />
              <span className="h-6 w-px bg-slate-200" aria-hidden />
              <SignOutButton compact />
            </div>
          </div>
          <div className="lg:hidden">
            <AppNav items={nav} mobile />
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}

import { Link } from '@/i18n/navigation';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { SignOutButton } from '@/components/SignOutButton';

export interface NavItem {
  href: string;
  label: string;
}

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
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-6">
            <Link href={home} className="font-semibold text-brand-600">
              {title}
            </Link>
            {nav.length > 0 && (
              <nav className="flex items-center gap-4">
                {nav.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="text-sm text-gray-600 hover:text-brand-600"
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
            )}
          </div>
          <div className="flex items-center gap-4">
            {/* A way back out to the public site — without this the only exit
                from an authenticated space is the browser's back button. */}
            <Link href="/" className="text-sm text-gray-500 hover:text-brand-600">
              Medic
            </Link>
            <LocaleSwitcher />
            <SignOutButton compact />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}

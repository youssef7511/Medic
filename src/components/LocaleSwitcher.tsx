'use client';

import { useLocale } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { locales, type Locale } from '@/i18n/config';

const LABEL: Record<Locale, string> = { fr: 'FR', ar: 'ع' };

// Swaps locale while staying on the current path. next-intl handles the prefix.
export function LocaleSwitcher() {
  const active = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  return (
    <div className="flex items-center rounded-xl border border-slate-200 bg-slate-50 p-1">
      {locales.map((locale) => (
        <button
          key={locale}
          type="button"
          aria-current={locale === active}
          onClick={() => router.replace(pathname, { locale })}
          className={'rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ' + (locale === active ? 'bg-navy-950 text-white shadow-sm' : 'text-slate-500 hover:bg-white hover:text-navy-950')}
        >
          {LABEL[locale]}
        </button>
      ))}
    </div>
  );
}

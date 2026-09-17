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
    <div className="flex items-center gap-1">
      {locales.map((locale) => (
        <button
          key={locale}
          type="button"
          aria-current={locale === active}
          onClick={() => router.replace(pathname, { locale })}
          className={
            'rounded px-2 py-1 text-sm ' +
            (locale === active ? 'bg-brand-500 text-white' : 'text-gray-600 hover:bg-gray-100')
          }
        >
          {LABEL[locale]}
        </button>
      ))}
    </div>
  );
}

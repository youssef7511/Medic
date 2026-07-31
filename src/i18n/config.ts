// §9: i18n foundation. fr is the default; ar is RTL. Adding a locale later is
// config, not rework — extend `locales`, drop in a messages file, done.

export const locales = ['fr', 'ar'] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'fr';

export const localeDirection: Record<Locale, 'ltr' | 'rtl'> = {
  fr: 'ltr',
  ar: 'rtl',
};

// §13.5: Western digits by default across all locales. Flip a locale's numbering
// system here (e.g. 'arab' for ٠١٢٣) without touching a single component —
// everything numeric renders through Intl using this.
export const localeNumberingSystem: Record<Locale, string> = {
  fr: 'latn',
  ar: 'latn',
};

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

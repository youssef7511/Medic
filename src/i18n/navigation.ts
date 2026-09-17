import { createNavigation } from 'next-intl/navigation';
import { defineRouting } from 'next-intl/routing';
import { defaultLocale, locales } from './config';

export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: 'always', // /fr/... and /ar/... — explicit, indexable (§4)
});

// Locale-aware Link / redirect / useRouter — import these, never next/link
// directly, so navigation always carries the active locale.
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);

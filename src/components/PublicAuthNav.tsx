'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { SignOutButton } from '@/components/SignOutButton';

/**
 * Auth-aware corner of the public header.
 *
 * Resolved on the client on purpose: the landing page is statically generated
 * for SEO (§4), and baking a personalised header into cached HTML would serve
 * one visitor's state to everyone. So the page stays cacheable and only this
 * fragment varies.
 *
 * The destination is `/go` rather than a hard-coded space, so the server picks
 * the right one from the visitor's roles — no roles in the token, nothing to go
 * stale. Nothing here is a security boundary; every space re-checks on arrival.
 */
export function PublicAuthNav() {
  const locale = useLocale();
  const t = useTranslations();
  const [state, setState] = useState<'loading' | 'in' | 'out'>('loading');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/session')
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (!cancelled) setState(s?.user ? 'in' : 'out');
      })
      .catch(() => {
        if (!cancelled) setState('out');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Reserve the space so the header doesn't jump when this resolves.
  if (state === 'loading') return <span className="inline-block h-8 w-24" aria-hidden />;

  if (state === 'in') {
    return (
      <div className="flex items-center gap-4">
        <a
          href={`/${locale}/go`}
          className="rounded bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600"
        >
          {locale === 'ar' ? 'فضائي' : 'Mon espace'}
        </a>
        <SignOutButton compact />
      </div>
    );
  }

  return (
    <Link
      href="/login"
      className="rounded bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600"
    >
      {t('common.login')}
    </Link>
  );
}

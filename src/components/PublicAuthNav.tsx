'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { SignOutButton } from '@/components/SignOutButton';

/**
 * Auth-aware corner of the public header.
 *
 * Resolved on the client so public content stays independent of session state.
 * Personalized controls never get baked into a shared public-page response.
 *
 * The destination is `/go` rather than a hard-coded space, so the server picks
 * the right one from the visitor's roles — no roles in the token, nothing to go
 * stale. Nothing here is a security boundary; every space re-checks on arrival.
 */
export function PublicAuthNav() {
  const locale = useLocale();
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
  if (state === 'loading') return <div className="public-auth public-auth-loading" aria-hidden><span /><span /></div>;

  if (state === 'in') {
    return (
      <div className="public-auth">
        <a
          href={`/${locale}/go`}
          className="editorial-button"
        >
          {locale === 'ar' ? 'فضائي' : 'Mon espace'}
        </a>
        <SignOutButton compact />
      </div>
    );
  }

  return (
    <div className="public-auth">
      <Link href="/login/doctor" className="editorial-button editorial-button-outline">{locale === 'ar' ? 'فضاء الطبيب' : 'Espace médecin'}</Link>
      <Link href="/login/patient" className="editorial-button">{locale === 'ar' ? 'فضاء المريض' : 'Espace patient'}</Link>
    </div>
  );
}

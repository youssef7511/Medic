'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { loginAction, type AuthFormState } from './actions';
import type { LoginPortal } from '@/lib/auth/portals';

const initial: AuthFormState = {};

export function LoginForm({ next, portal }: { next?: string; portal: LoginPortal }) {
  const locale = useLocale();
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(loginAction, initial);

  // Email and password are controlled so they survive the re-render that
  // reveals the TOTP field. Uncontrolled inputs reset on that re-render, which
  // forced the user to retype their password just to enter a 6-digit code.
  // The credentials never leave the client here — the action still re-submits
  // them so the server can re-verify before accepting the code.
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const totpRef = useRef<HTMLInputElement>(null);

  // Once the server says MFA is needed, the credentials were valid — reveal the
  // code field. Until then it stays hidden so the form gives nothing away.
  const needsTotp = state.error === 'mfa_required';

  // Send the cursor straight to the code field when it appears.
  useEffect(() => {
    if (needsTotp) totpRef.current?.focus();
  }, [needsTotp]);

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="next" value={next ?? ''} />
      <input type="hidden" name="portal" value={portal} />

      <div>
        <label htmlFor="email" className="block text-sm font-semibold text-navy-950">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          readOnly={needsTotp}
          placeholder="nom@exemple.com"
          className="mt-2 h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm read-only:bg-slate-50 read-only:text-slate-500"
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-semibold text-navy-950">
          {locale === 'ar' ? 'كلمة المرور' : 'Mot de passe'}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          readOnly={needsTotp}
          className="mt-2 h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm read-only:bg-slate-50 read-only:text-slate-500"
        />
      </div>

      {needsTotp && (
        <div>
          <label htmlFor="totp" className="block text-sm font-semibold text-navy-950">
            {locale === 'ar' ? 'رمز التحقق' : 'Code de vérification'}
          </label>
          <input
            ref={totpRef}
            id="totp"
            name="totp"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            maxLength={6}
            className="mt-2 h-12 w-full rounded-xl border border-slate-300 px-3 text-center text-lg font-semibold tracking-[0.35em]"
          />
          <p className="mt-1 text-xs text-gray-500">
            {locale === 'ar'
              ? 'أدخل الرمز من تطبيق المصادقة.'
              : "Entrez le code de votre application d'authentification."}
          </p>
        </div>
      )}

      {state.error === 'invalid' && (
        <p role="alert" className="text-sm text-red-600">
          {locale === 'ar'
            ? 'بيانات الدخول غير صحيحة.'
            : 'Identifiants invalides.'}
        </p>
      )}
      {state.error === 'account_suspended' && (
        <p role="alert" className="text-sm text-red-600">
          {locale === 'ar' ? 'تم تعليق هذا الحساب.' : 'Ce compte est suspendu.'}
        </p>
      )}
      {state.error === 'mfa_enrollment_required' && (
        <div role="alert" className="rounded border border-amber-200 bg-amber-50 p-3 text-sm">
          <p className="text-amber-800">
            {locale === 'ar'
              ? 'يجب تفعيل المصادقة الثنائية قبل تسجيل الدخول.'
              : "L'authentification à deux facteurs doit être activée avant la connexion."}
          </p>
          <Link
            href="/enroll-mfa"
            className="mt-2 inline-block font-medium text-brand-600 hover:underline"
          >
            {locale === 'ar' ? 'إعداد المصادقة الثنائية ←' : 'Configurer maintenant →'}
          </Link>
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="h-12 w-full rounded-xl bg-brand-600 px-4 font-semibold text-white shadow-lg shadow-brand-600/15 hover:bg-brand-700 disabled:opacity-60"
      >
        {pending ? t('common.loading') : t('common.login')}
      </button>
    </form>
  );
}

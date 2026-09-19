'use client';

import { useActionState, useState } from 'react';
import Image from 'next/image';
import { Link } from '@/i18n/navigation';
import { useLocale } from 'next-intl';
import { beginEnrollment, confirmEnrollment, type EnrollState } from './actions';

const initial: EnrollState = { step: 'credentials' };

export function EnrollMfaForm() {
  const locale = useLocale();
  const ar = locale === 'ar';
  const [beginState, beginAction, beginPending] = useActionState(beginEnrollment, initial);
  const [confirmState, confirmAction, confirmPending] = useActionState(confirmEnrollment, initial);

  // Credentials are re-submitted on step 2 so the server can re-authenticate
  // before promoting the pending secret.
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [enrollmentToken, setEnrollmentToken] = useState('');

  const state = confirmState.step === 'done' ? confirmState : beginState;

  if (state.step === 'done' || confirmState.step === 'done') {
    return (
      <div className="rounded-2xl border border-green-200 bg-green-50 p-5">
        <p className="font-semibold text-green-800">{ar ? 'المصادقة الثنائية مفعلة.' : 'L’authentification à deux facteurs est active.'}</p>
        <Link href="/login" className="mt-3 inline-block text-sm text-brand-600 hover:underline">
          {ar ? 'متابعة تسجيل الدخول ←' : 'Continuer vers la connexion →'}
        </Link>
      </div>
    );
  }

  if (beginState.step === 'verify' && beginState.qrDataUrl) {
    return (
      <form action={confirmAction} className="space-y-4">
        <input type="hidden" name="email" value={email} />
        <input type="hidden" name="password" value={password} />
        <input type="hidden" name="enrollmentToken" value={enrollmentToken} />

        <p className="text-sm leading-6 text-slate-600">
          {ar ? 'امسح هذا الرمز بتطبيق المصادقة، ثم أدخل الرمز المكوّن من 6 أرقام.' : 'Scannez ce QR code avec votre application d’authentification, puis saisissez le code à 6 chiffres.'}
        </p>

        <Image
          src={beginState.qrDataUrl}
          alt={ar ? 'رمز QR لإعداد المصادقة الثنائية' : 'QR code d’activation de la double authentification'}
          width={220}
          height={220}
          unoptimized
          className="mx-auto rounded-2xl border border-slate-200 bg-white p-2"
        />

        <details className="text-sm text-slate-500">
          <summary className="cursor-pointer font-medium">{ar ? 'لا تستطيع مسح الرمز؟' : 'Impossible de scanner le QR code ?'}</summary>
          <p className="mt-2 break-all font-mono text-xs">{beginState.manualKey}</p>
        </details>

        <div>
          <label htmlFor="totp" className="block text-sm font-semibold text-navy-950">
            {ar ? 'رمز المصادقة' : 'Code d’authentification'}
          </label>
          <input
            id="totp"
            name="totp"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            maxLength={6}
            className="mt-2 h-12 w-full rounded-xl border border-slate-300 px-3 text-center text-lg font-semibold tracking-[0.35em]"
          />
        </div>

        {confirmState.error && (
          <p role="alert" className="text-sm text-red-600">
            {confirmState.error}
          </p>
        )}

        <button
          type="submit"
          disabled={confirmPending}
          className="h-12 w-full rounded-xl bg-brand-600 px-4 font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {confirmPending ? (ar ? 'جارٍ التحقق…' : 'Vérification…') : (ar ? 'تفعيل المصادقة الثنائية' : 'Activer la double authentification')}
        </button>
      </form>
    );
  }

  return (
    <form action={beginAction} className="space-y-4">
      <p className="rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">
        {ar ? 'تتطلب حسابات الأطباء والموظفين والمسؤولين المصادقة الثنائية. استخدم رمز التفعيل أحادي الاستخدام الذي قدمه المسؤول.' : 'Les comptes médecin, personnel et administrateur exigent la double authentification. Utilisez le jeton à usage unique remis par votre administrateur.'}
      </p>

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
          className="mt-2 h-12 w-full rounded-xl border border-slate-300 px-3 text-sm"
        />
      </div>

      <div>
        <label htmlFor="enrollmentToken" className="block text-sm font-semibold text-navy-950">
          {ar ? 'رمز التفعيل' : 'Jeton d’activation'}
        </label>
        <input
          id="enrollmentToken"
          name="enrollmentToken"
          type="password"
          required
          autoComplete="off"
          value={enrollmentToken}
          onChange={(e) => setEnrollmentToken(e.target.value)}
          className="mt-2 h-12 w-full rounded-xl border border-slate-300 px-3 font-mono text-sm"
        />
        <p className="mt-1 text-xs text-gray-500">
          {ar ? 'استخدم الرمز أحادي الاستخدام الذي قدمه المسؤول.' : 'Utilisez le jeton à usage unique fourni par votre administrateur.'}
        </p>
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-semibold text-navy-950">
          {ar ? 'كلمة المرور' : 'Mot de passe'}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-2 h-12 w-full rounded-xl border border-slate-300 px-3 text-sm"
        />
      </div>

      {beginState.error && (
        <p role="alert" className="text-sm text-red-600">
          {beginState.error}
        </p>
      )}

      <button
        type="submit"
        disabled={beginPending}
        className="h-12 w-full rounded-xl bg-brand-600 px-4 font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
      >
        {beginPending ? (ar ? 'جارٍ التحقق…' : 'Vérification…') : (ar ? 'بدء الإعداد' : 'Commencer la configuration')}
      </button>
    </form>
  );
}

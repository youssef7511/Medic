'use client';

import { useActionState, useState } from 'react';
import Image from 'next/image';
import { Link } from '@/i18n/navigation';
import { beginEnrollment, confirmEnrollment, type EnrollState } from './actions';

const initial: EnrollState = { step: 'credentials' };

export function EnrollMfaForm() {
  const [beginState, beginAction, beginPending] = useActionState(beginEnrollment, initial);
  const [confirmState, confirmAction, confirmPending] = useActionState(confirmEnrollment, initial);

  // Credentials are re-submitted on step 2 so the server can re-authenticate
  // before promoting the pending secret.
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const state = confirmState.step === 'done' ? confirmState : beginState;

  if (state.step === 'done' || confirmState.step === 'done') {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-4">
        <p className="font-medium text-green-800">Two-factor authentication is active.</p>
        <Link href="/login" className="mt-3 inline-block text-sm text-brand-600 hover:underline">
          Continue to sign in →
        </Link>
      </div>
    );
  }

  if (beginState.step === 'verify' && beginState.qrDataUrl) {
    return (
      <form action={confirmAction} className="space-y-4">
        <input type="hidden" name="email" value={email} />
        <input type="hidden" name="password" value={password} />

        <p className="text-sm text-gray-600">
          Scan this with your authenticator app, then enter the 6-digit code to finish.
        </p>

        <Image
          src={beginState.qrDataUrl}
          alt="Two-factor enrollment QR code"
          width={220}
          height={220}
          unoptimized
          className="rounded border border-gray-200"
        />

        <details className="text-sm text-gray-500">
          <summary className="cursor-pointer">Can&apos;t scan it?</summary>
          <p className="mt-2 break-all font-mono text-xs">{beginState.manualKey}</p>
        </details>

        <div>
          <label htmlFor="totp" className="block text-sm font-medium">
            Authentication code
          </label>
          <input
            id="totp"
            name="totp"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 tracking-widest"
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
          className="w-full rounded bg-brand-500 px-4 py-2 font-medium text-white hover:bg-brand-600 disabled:opacity-60"
        >
          {confirmPending ? 'Verifying…' : 'Activate two-factor'}
        </button>
      </form>
    );
  }

  return (
    <form action={beginAction} className="space-y-4">
      <p className="text-sm text-gray-600">
        Doctor, staff and administrator accounts require two-factor
        authentication. Sign in once here to set it up.
      </p>

      <div>
        <label htmlFor="email" className="block text-sm font-medium">
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
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
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
        className="w-full rounded bg-brand-500 px-4 py-2 font-medium text-white hover:bg-brand-600 disabled:opacity-60"
      >
        {beginPending ? 'Checking…' : 'Begin setup'}
      </button>
    </form>
  );
}

'use client';

import { useLocale } from 'next-intl';
import { LogOut } from 'lucide-react';
import { signOutAction } from '@/lib/auth/actions';

export function SignOutButton({ compact = false }: { compact?: boolean }) {
  const locale = useLocale();
  const label = locale === 'ar' ? 'تسجيل الخروج' : 'Se déconnecter';

  return (
    <form action={signOutAction}>
      <button
        type="submit"
        className="flex items-center gap-1.5 rounded-lg p-2 text-sm text-slate-500 hover:bg-red-50 hover:text-red-600"
        aria-label={label}
      >
        <LogOut className="h-4 w-4" />
        {!compact && <span>{label}</span>}
      </button>
    </form>
  );
}

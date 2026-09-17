import { AlertTriangle, ShieldCheck, HelpCircle } from 'lucide-react';
import type { AllergyState } from '@/lib/clinical/allergies';

/**
 * Renders the patient's drug-allergy state (§3.1) at the top of the prescribing
 * screen. The three states are visually distinct on purpose — `not_recorded`
 * is shown as an amber warning, NEVER as a reassuring blank or a green "none",
 * because absence of data is not a clean bill of health.
 */
export function AllergyPanel({ state, locale }: { state: AllergyState; locale: string }) {
  const ar = locale === 'ar';

  if (state.kind === 'listed') {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-4">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
        <div>
          <p className="text-sm font-semibold text-red-800">
            {ar ? 'حساسية دوائية معروفة' : 'Allergies médicamenteuses connues'}
          </p>
          <p dir="auto" className="mt-1 whitespace-pre-wrap text-sm text-red-900">
            {state.text}
          </p>
        </div>
      </div>
    );
  }

  if (state.kind === 'none') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-green-300 bg-green-50 p-4">
        <ShieldCheck className="h-5 w-5 shrink-0 text-green-600" />
        <p className="text-sm text-green-800">
          {ar ? 'لا حساسية دوائية معروفة (مؤكَّدة)' : 'Aucune allergie médicamenteuse connue (confirmé)'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-4">
      <HelpCircle className="h-5 w-5 shrink-0 text-amber-600" />
      <p className="text-sm text-amber-800">
        {ar
          ? 'الحساسيات غير مسجَّلة — لم تُؤكَّد بعد. توخَّ الحذر.'
          : 'Allergies non renseignées — non confirmées. Prudence.'}
      </p>
    </div>
  );
}

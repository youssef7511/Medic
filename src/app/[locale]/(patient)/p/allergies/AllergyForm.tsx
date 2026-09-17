'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
import { Button } from '@/components/ui/button';
import { saveAllergiesAction, type AllergyState } from './actions';

export function AllergyForm({
  initialText,
  initialAffirmedNone,
}: {
  initialText: string;
  initialAffirmedNone: boolean;
}) {
  const locale = useLocale();
  const ar = locale === 'ar';
  const [text, setText] = useState(initialText);
  const [affirmedNone, setAffirmedNone] = useState(initialAffirmedNone);
  const [state, setState] = useState<AllergyState>({});
  const [pending, setPending] = useState(false);

  async function submit() {
    setPending(true);
    setState({});
    const fd = new FormData();
    fd.set('affirmedNone', affirmedNone ? 'true' : 'false');
    if (!affirmedNone) fd.set('text', text);
    const result = await saveAllergiesAction({}, fd);
    setPending(false);
    setState(result);
  }

  return (
    <div className="space-y-4">
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={affirmedNone}
          onChange={(e) => setAffirmedNone(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          {ar
            ? 'ليس لديّ أي حساسية دوائية معروفة.'
            : "Je n'ai aucune allergie médicamenteuse connue."}
        </span>
      </label>

      <div className={affirmedNone ? 'opacity-40' : ''}>
        <label htmlFor="allergies" className="block text-sm font-medium">
          {ar ? 'الحساسيات الدوائية' : 'Allergies médicamenteuses'}
        </label>
        <textarea
          id="allergies"
          value={text}
          disabled={affirmedNone}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          dir="auto"
          maxLength={2000}
          placeholder={ar ? 'مثال: البنسلين' : 'Ex. : pénicilline'}
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50"
        />
      </div>

      {state.ok && (
        <p role="status" className="text-sm text-green-700">
          {ar ? 'تم الحفظ.' : 'Enregistré.'}
        </p>
      )}
      {state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}

      <Button type="button" disabled={pending} onClick={() => void submit()}>
        {pending ? (ar ? 'جارٍ الحفظ…' : 'Enregistrement…') : ar ? 'حفظ' : 'Enregistrer'}
      </Button>
    </div>
  );
}

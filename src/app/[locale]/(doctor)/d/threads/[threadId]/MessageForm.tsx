'use client';

import { useRef, useEffect, useActionState } from 'react';
import { useLocale } from 'next-intl';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { sendMessageAction, type MessageState } from './actions';

/**
 * Message composition form (§7). Textarea + send button. Uses useActionState
 * for progressive enhancement — works without JS (full-page reload), and with
 * JS the form clears on success and scrolls to the new message.
 */
export function MessageForm({
  threadId,
  locale,
}: {
  threadId: string;
  locale: string;
}) {
  const ar = locale === 'ar';
  const formRef = useRef<HTMLFormElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const [state, formAction, pending] = useActionState<MessageState, FormData>(
    sendMessageAction,
    {},
  );

  // After successful send, scroll to bottom and reset form.
  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [state.ok]);

  return (
    <div className="border-t border-gray-200 bg-white p-4">
      {/* Safety banner (§7) */}
      <p className="mb-3 rounded bg-amber-50 p-2 text-center text-xs text-amber-800">
        {ar
          ? 'هذه الخدمة ليست مخصّصة للحالات الطارئة. في حال الطوارئ اتصل بالإسعاف.'
          : 'Ce service n\'est pas destiné aux urgences. En cas d\'urgence, appelez les secours.'}
      </p>

      <form
        ref={formRef}
        action={formAction}
        className="flex items-end gap-2"
      >
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="threadId" value={threadId} />
        <textarea
          name="body"
          required
          rows={2}
          maxLength={5000}
          dir="auto"
          placeholder={ar ? 'اكتب رسالتك…' : 'Écrivez votre message…'}
          className="flex-1 resize-none rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <Button type="submit" size="icon" disabled={pending}>
          <Send className="h-4 w-4" />
        </Button>
      </form>

      {state.error && (
        <p role="alert" className="mt-2 text-sm text-red-600">{state.error}</p>
      )}

      <div ref={bottomRef} />
    </div>
  );
}

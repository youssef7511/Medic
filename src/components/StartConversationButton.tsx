'use client';
import { useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { MessageSquare, Loader2 } from 'lucide-react';
export function StartConversationButton({ linkId, basePath, locale }: { linkId: string; basePath: string; locale: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const router = useRouter();
  async function start() {
    setPending(true); setError(false);
    try {
      const response = await fetch('/api/messages/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ linkId }) });
      if (!response.ok) throw new Error('start_failed');
      const { id } = await response.json();
      router.push(`${basePath}/${id}`);
    } catch { setError(true); setPending(false); }
  }
  return <div className="mt-5"><button disabled={pending} onClick={() => void start()} className="flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">{pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />}{locale === 'ar' ? 'فتح محادثة مشفرة' : 'Ouvrir la conversation chiffrée'}</button>{error && <p role="alert" className="mt-2 text-sm text-red-700">{locale === 'ar' ? 'تعذر فتح المحادثة.' : 'Impossible d’ouvrir la conversation.'}</p>}</div>;
}

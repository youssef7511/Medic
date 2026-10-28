import { Link } from '@/i18n/navigation';
import { MessageSquare, ChevronRight } from 'lucide-react';
import type { ThreadView } from '@/lib/messaging/threads';

export function PatientThreads({ threads, doctorIds, locale }: { threads: ThreadView[]; doctorIds: Record<string, string>; locale: string }) {
  const ar = locale === 'ar';
  if (!threads.length) return <div className="p-8 text-center"><MessageSquare className="mx-auto h-9 w-9 text-slate-300" /><p className="mt-3 text-sm text-slate-500">{ar ? 'لا توجد رسائل بعد.' : 'Aucune conversation pour le moment.'}</p></div>;
  return <ul className="divide-y divide-slate-100">{threads.filter(thread => doctorIds[thread.linkId]).map(thread => <li key={thread.id}>
    <Link href={`/p/doctors/${doctorIds[thread.linkId]}/messages/${thread.id}`} className="flex items-center gap-3 px-5 py-4 transition hover:bg-sky-50/50">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-sky-100 text-sm font-bold text-sky-800">{thread.doctorName.split(/\s+/).slice(0, 2).map(part => part[0]).join('')}</span>
      <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{thread.doctorName}</p><p className="mt-1 truncate text-xs text-slate-500">{thread.lastMessagePreview || thread.subject || (ar ? 'محادثة' : 'Conversation')}</p></div>
      <div className="flex shrink-0 flex-col items-end gap-2">{thread.lastMessageAt && <time dateTime={thread.lastMessageAt.toISOString()} className="text-[11px] text-slate-400">{thread.lastMessageAt.toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'Africa/Tunis' })}</time>}{thread.unreadCount > 0 ? <span aria-label={ar ? 'رسائل غير مقروءة' : 'Messages non lus'} className="rounded-full bg-brand-600 px-2 py-0.5 text-xs font-bold text-white">{thread.unreadCount}</span> : <ChevronRight className="h-4 w-4 text-slate-300 rtl:rotate-180" />}</div>
    </Link>
  </li>)}</ul>;
}

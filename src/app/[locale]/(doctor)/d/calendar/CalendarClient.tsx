'use client';

import { useState, useTransition } from 'react';
import { DateTime } from 'luxon';
import { ChevronLeft, ChevronRight, Search, CalendarDays, Clock3, MapPin, X } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/button';
import { WeekGrid } from '@/components/calendar/WeekGrid';
import { Link, useRouter } from '@/i18n/navigation';
import { AppointmentStatusBadge } from '@/components/AppointmentStatusBadge';
import { AppointmentActions } from '../AppointmentActions';
import type { WeekCalendar } from '@/lib/calendar/queries';

export function CalendarClient({ calendar, weekParam, locale, view }: {
  calendar: WeekCalendar; weekParam: string; locale: string; view: 'month' | 'week';
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const ar = locale === 'ar';
  const anchor = DateTime.fromISO(weekParam, { zone: calendar.timezone });
  const go = (iso: string, nextView = view) => startTransition(() => router.push(`/d/calendar?week=${iso}&view=${nextView}`));
  const shift = (direction: number) => go(anchor.plus(view === 'month' ? { months: direction } : { weeks: direction }).toISODate()!);
  const events = calendar.events.filter(event => (status === 'all' || event.status === status) && `${event.patientName} ${event.clinicName}`.toLocaleLowerCase(locale).includes(query.toLocaleLowerCase(locale)));
  const selected = calendar.events.find(event => event.id === selectedId);
  const localDate = (date: Date) => DateTime.fromJSDate(new Date(date)).setZone(calendar.timezone).setLocale(locale);
  const Prev = ar ? ChevronRight : ChevronLeft;
  const Next = ar ? ChevronLeft : ChevronRight;
  const labels: Record<string, string> = { CONFIRMED: ar ? 'مؤكد' : 'Confirmé', REQUESTED: ar ? 'قيد الانتظار' : 'En attente', COMPLETED: ar ? 'منتهٍ' : 'Terminé', NO_SHOW: ar ? 'لم يحضر' : 'Absent' };
  return <div aria-busy={pending}>
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3"><Button variant="outline" size="icon" onClick={() => shift(-1)} disabled={pending} aria-label={ar ? 'السابق' : 'Période précédente'}><Prev className="h-4 w-4" /></Button><h2 className="min-w-32 text-lg font-bold capitalize">{view === 'month' ? anchor.setLocale(locale).toFormat('LLLL yyyy') : calendar.rangeLabel}</h2><Button variant="outline" size="icon" onClick={() => shift(1)} disabled={pending} aria-label={ar ? 'التالي' : 'Période suivante'}><Next className="h-4 w-4" /></Button><Button variant="outline" size="sm" onClick={() => go(DateTime.now().setZone(calendar.timezone).toISODate()!)} disabled={pending}>{ar ? 'اليوم' : "Aujourd’hui"}</Button></div>
      <div className="flex flex-wrap items-center gap-3"><div className="flex rounded-lg border border-slate-200 bg-slate-50 p-1">{(['month', 'week'] as const).map(mode => <button key={mode} type="button" aria-pressed={view === mode} disabled={pending} onClick={() => go(weekParam, mode)} className={`rounded-md px-4 py-2 text-xs font-semibold ${mode === view ? 'bg-navy-900 text-white shadow-sm' : 'text-slate-500'}`}>{mode === 'month' ? (ar ? 'شهر' : 'Mois') : (ar ? 'أسبوع' : 'Semaine')}</button>)}</div>
        <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3"><Search className="h-4 w-4 text-slate-400" /><input value={query} onChange={event => setQuery(event.target.value)} aria-label={ar ? 'البحث عن موعد' : 'Rechercher un rendez-vous'} placeholder={ar ? 'ابحث عن موعد…' : 'Rechercher un rendez-vous…'} className="h-10 w-44 bg-transparent text-xs focus:ring-0" /></label>
        <select aria-label={ar ? 'تصفية حسب الحالة' : 'Filtrer par statut'} value={status} onChange={event => setStatus(event.target.value)} className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs"><option value="all">{ar ? 'كل الحالات' : 'Tous les statuts'}</option>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      </div>
    </div>
    <div className={`overflow-hidden rounded-xl border border-slate-200 bg-white ${pending ? 'opacity-60' : ''}`}>
      {view === 'week' ? <WeekGrid {...calendar} events={events} locale={locale} onSelect={setSelectedId} /> : <div className="overflow-x-auto"><div className="min-w-[650px]">
        <div className="grid grid-cols-7 bg-slate-50">{calendar.days.slice(0, 7).map(day => <div key={day.isoDate} className="border-e border-slate-200 py-3 text-center text-xs font-semibold capitalize">{DateTime.fromISO(day.isoDate).setLocale(locale).toFormat('ccc')}</div>)}</div>
        <div className="grid grid-cols-7">{calendar.days.map(day => {
          const date = DateTime.fromISO(day.isoDate);
          const dayEvents = events.filter(event => localDate(event.startAt).toISODate() === day.isoDate);
          return <div key={day.isoDate} className={`min-h-[125px] border-e border-t border-slate-200 p-2 ${day.isToday ? 'bg-sky-50' : date.month !== anchor.month ? 'bg-slate-50/70' : ''}`}><span className={`mb-2 grid h-7 w-7 place-items-center rounded-full text-xs font-semibold ${day.isToday ? 'bg-navy-900 text-white' : date.month !== anchor.month ? 'text-slate-400' : 'text-navy-900'}`}>{date.day}</span><div className="space-y-1.5">{dayEvents.map(event => <button key={event.id} type="button" onClick={() => setSelectedId(event.id)} title={`${event.timeLabel} · ${event.patientName} · ${event.clinicName}`} className={`flex w-full items-center gap-1.5 rounded-md border-s-2 px-2 py-1.5 text-start text-[11px] transition hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-600 ${event.status === 'CONFIRMED' ? 'border-brand-500 bg-brand-200/80 text-brand-900' : event.status === 'REQUESTED' ? 'border-amber-500 bg-amber-200/80 text-amber-900' : 'border-slate-400 bg-slate-200 text-slate-600'}`}><span className="shrink-0 font-bold">{event.timeLabel}</span><span className="truncate">{event.patientName}</span></button>)}</div></div>;
        })}</div>
      </div></div>}
    </div>
    {events.length === 0 && <p role="status" className="mt-4 text-center text-sm text-slate-500">{ar ? 'لا توجد مواعيد لهذه الفترة أو عوامل التصفية.' : 'Aucun rendez-vous pour cette période ou ces filtres.'}</p>}
    <div className="mt-5 flex flex-wrap items-center gap-5 text-xs text-slate-500">{Object.entries(labels).map(([key, label]) => <span key={key} className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${key === 'CONFIRMED' ? 'bg-brand-500' : key === 'REQUESTED' ? 'bg-amber-400' : 'bg-slate-400'}`} />{label}</span>)}<span className="ms-auto">{events.length} {ar ? 'موعد' : 'rendez-vous'} · {calendar.timezone}</span></div>
    <Dialog.Root open={Boolean(selected)} onOpenChange={open => { if (!open) setSelectedId(null); }}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-40 bg-navy-950/25 backdrop-blur-sm" /><Dialog.Content dir={ar ? 'rtl' : 'ltr'} className="fixed inset-y-0 end-0 z-50 w-full max-w-sm overflow-y-auto border-s border-slate-200 bg-white p-6 shadow-2xl">
      <Dialog.Title className="pe-8 text-lg font-bold">{ar ? 'تفاصيل الموعد' : 'Détails du rendez-vous'}</Dialog.Title><Dialog.Description className="mt-2 text-xs text-slate-500">{ar ? 'راجع الموعد وحدّث حالته.' : 'Consultez le rendez-vous et mettez à jour son statut.'}</Dialog.Description><Dialog.Close aria-label={ar ? 'إغلاق' : 'Fermer'} className="absolute end-5 top-6 rounded-lg p-1 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></Dialog.Close>
      {selected && <><div className="my-8 flex items-center gap-4"><span className="grid h-16 w-16 place-items-center rounded-full bg-sky-100 text-lg font-bold text-sky-800">{selected.patientName.split(/\s+/).slice(0, 2).map(part => part[0]).join('')}</span><h3 className="text-lg font-bold">{selected.patientName}</h3></div><div className="space-y-6 text-sm"><p className="flex gap-4"><CalendarDays className="h-5 w-5 shrink-0 text-slate-500" /><span className="capitalize">{localDate(selected.startAt).toFormat('cccc d LLLL yyyy')}</span></p><p className="flex gap-4"><Clock3 className="h-5 w-5 shrink-0 text-slate-500" />{selected.timeLabel} – {localDate(selected.endAt).toFormat('HH:mm')}</p><p className="flex gap-4"><MapPin className="h-5 w-5 shrink-0 text-slate-500" />{selected.clinicName}</p></div><div className="mt-8 flex items-center justify-between border-t border-slate-100 pt-5"><p className="text-sm text-slate-500">{ar ? 'الحالة' : 'Statut'}</p><AppointmentStatusBadge status={selected.status} locale={locale} /></div><div className="mt-8"><AppointmentActions stacked key={selected.id} appointmentId={selected.id} status={selected.status} isPast={new Date(selected.startAt).getTime() < Date.now()} locale={locale} /><Link href={`/d/patients/${selected.linkId}`} className="mt-3 block rounded-xl border border-sky-200 py-3 text-center text-sm font-semibold text-sky-800 hover:bg-sky-50">{ar ? 'فتح ملف المريض' : 'Ouvrir le dossier patient'}</Link></div></>}
    </Dialog.Content></Dialog.Portal></Dialog.Root>
  </div>;
}

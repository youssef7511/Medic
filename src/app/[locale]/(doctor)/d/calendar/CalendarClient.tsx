'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WeekGrid } from '@/components/calendar/WeekGrid';
import { useRouter } from '@/i18n/navigation';
import type { WeekCalendar } from '@/lib/calendar/queries';

/**
 * Week navigation lives in the URL (`?week=YYYY-MM-DD`) rather than component
 * state, so a doctor can bookmark or share a specific week and a refresh keeps
 * their place. The data itself is fetched server-side per week.
 */
export function CalendarClient({
  calendar,
  weekParam,
  locale,
}: {
  calendar: WeekCalendar;
  weekParam: string;
  locale: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const ar = locale === 'ar';

  const go = (iso: string) => {
    setPending(true);
    router.push(`/d/calendar?week=${iso}`);
  };

  const shift = (direction: -1 | 1) => {
    const base = new Date(`${weekParam}T12:00:00Z`);
    base.setUTCDate(base.getUTCDate() + direction * 7);
    go(base.toISOString().slice(0, 10));
  };

  // Chevrons point at the *previous*/*next* week, so they must mirror in RTL —
  // "back" is on the right in Arabic.
  const PrevIcon = ar ? ChevronRight : ChevronLeft;
  const NextIcon = ar ? ChevronLeft : ChevronRight;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => shift(-1)}
            disabled={pending}
            aria-label={ar ? 'الأسبوع السابق' : 'Semaine précédente'}
          >
            <PrevIcon className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => shift(1)}
            disabled={pending}
            aria-label={ar ? 'الأسبوع التالي' : 'Semaine suivante'}
          >
            <NextIcon className="h-4 w-4" />
          </Button>
          <Button
            variant="subtle"
            size="sm"
            onClick={() => go(new Date().toISOString().slice(0, 10))}
            disabled={pending}
          >
            {ar ? 'اليوم' : "Aujourd'hui"}
          </Button>
        </div>

        <p className="text-sm font-medium capitalize text-gray-700">{calendar.rangeLabel}</p>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <WeekGrid
          days={calendar.days}
          events={calendar.events}
          bands={calendar.bands}
          closedDates={calendar.closedDates}
          bounds={calendar.bounds}
          timezone={calendar.timezone}
          locale={locale}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-gray-500">
        <Legend className="border-amber-300 bg-amber-100" label={ar ? 'قيد الانتظار' : 'En attente'} />
        <Legend className="border-brand-500 bg-brand-100" label={ar ? 'مؤكَّد' : 'Confirmé'} />
        <Legend className="border-gray-300 bg-gray-100" label={ar ? 'منتهٍ' : 'Terminé'} />
        <Legend className="border-red-300 bg-red-100" label={ar ? 'لم يحضر' : 'Absent'} />
        <span className="ms-auto">{calendar.timezone}</span>
      </div>
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block h-3 w-3 rounded border ${className}`} />
      {label}
    </span>
  );
}

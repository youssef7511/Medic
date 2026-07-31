import { redirect } from 'next/navigation';
import { getCurrentActor } from '@/lib/auth/session';
import { hasPermission } from '@/lib/rbac/guard';
import { getWeekCalendar } from '@/lib/calendar/queries';
import { CalendarClient } from './CalendarClient';

export const dynamic = 'force-dynamic';

export default async function CalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ week?: string }>;
}) {
  const { locale } = await params;
  const { week } = await searchParams;

  const actor = await getCurrentActor();
  if (!actor) redirect(`/${locale}/login`);

  // Staff can read the calendar; clinical content is gated elsewhere (§5).
  if (!hasPermission(actor, 'calendar:read')) redirect(`/${locale}`);

  // Accept only YYYY-MM-DD — an unvalidated param becomes an invalid Date and
  // silently renders an empty week.
  const valid = week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? week : null;
  const anchor = valid ? new Date(`${valid}T12:00:00Z`) : new Date();
  const weekParam = anchor.toISOString().slice(0, 10);

  const calendar = await getWeekCalendar({ userId: actor.userId, anchor, locale });

  if (!calendar) {
    return (
      <section>
        <h1 className="text-2xl font-bold">{locale === 'ar' ? 'التقويم' : 'Agenda'}</h1>
        <p className="mt-4 text-gray-500">
          {locale === 'ar'
            ? 'هذا الحساب غير مرتبط بملف طبيب.'
            : "Ce compte n'est pas associé à un profil médecin."}
        </p>
      </section>
    );
  }

  return (
    <section>
      <h1 className="mb-4 text-2xl font-bold">{locale === 'ar' ? 'التقويم' : 'Agenda'}</h1>
      <CalendarClient calendar={calendar} weekParam={weekParam} locale={locale} />
    </section>
  );
}

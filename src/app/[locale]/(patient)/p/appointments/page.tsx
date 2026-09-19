import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getCurrentActor } from '@/lib/auth/session';
import { getPatientAppointments } from '@/lib/booking/queries';
import { AppointmentStatusBadge } from '@/components/AppointmentStatusBadge';
import { CancelButton } from './CancelButton';
import { CalendarDays, MapPin, Plus, Stethoscope } from 'lucide-react';
import { Link } from '@/i18n/navigation';

export const dynamic = 'force-dynamic';

export default async function PatientAppointmentsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations();

  const actor = await getCurrentActor();
  if (!actor) redirect(`/${locale}/login`);

  const appointments = await getPatientAppointments(actor.userId, locale);
  const ar = locale === 'ar';
  const upcomingCount = appointments.filter((item) => !item.isPast && !['CANCELLED', 'COMPLETED', 'NO_SHOW'].includes(item.status)).length;

  return (
    <section>
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="medic-kicker">{ar ? 'متابعة الرعاية' : 'Suivi des soins'}</p><h1 className="medic-page-title mt-2">{t('nav.myAppointments')}</h1><p className="mt-2 text-sm text-slate-500">{upcomingCount} {ar ? 'موعد قادم' : 'rendez-vous à venir'}</p></div><Link href="/doctors" className="inline-flex items-center justify-center gap-2 self-start rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 sm:self-auto"><Plus className="h-4 w-4" />{ar ? 'موعد جديد' : 'Nouveau rendez-vous'}</Link></div>

      {appointments.length === 0 ? (
        <div className="medic-panel mt-6 p-10 text-center"><CalendarDays className="mx-auto h-10 w-10 text-slate-300" /><p className="mt-4 text-sm font-semibold text-navy-950">{ar ? 'لا توجد مواعيد بعد.' : 'Aucun rendez-vous pour le moment.'}</p><Link href="/doctors" className="mt-2 inline-block text-sm font-semibold text-brand-700 hover:underline">{ar ? 'ابحث عن طبيب' : 'Trouver un médecin'}</Link></div>
      ) : (
        <ul className="medic-panel mt-6 divide-y divide-slate-100">
          {appointments.map((a) => {
            // Only a future, still-live appointment can be cancelled — mirrors
            // the server-side rule in lifecycle.ts rather than guessing.
            const cancellable = !a.isPast && ['REQUESTED', 'CONFIRMED'].includes(a.status);
            return (
              <li key={a.id} className="flex flex-col justify-between gap-4 p-5 sm:flex-row sm:items-center">
                <div className="flex items-start gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700"><Stethoscope className="h-5 w-5" /></span><div>
                  <p className="font-bold text-navy-950">{a.counterpartyName}</p>
                  <p className="mt-1 text-sm capitalize text-slate-600">{a.whenLabel}</p>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-400"><MapPin className="h-3.5 w-3.5" />{a.clinicName}</p>
                  <div className="mt-2">
                    <AppointmentStatusBadge status={a.status} locale={locale} />
                  </div>
                </div></div>
                {cancellable && <CancelButton appointmentId={a.id} locale={locale} />}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getCurrentActor } from '@/lib/auth/session';
import { getPatientAppointments } from '@/lib/booking/queries';
import { AppointmentStatusBadge } from '@/components/AppointmentStatusBadge';
import { CancelButton } from './CancelButton';

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

  return (
    <section>
      <h1 className="text-2xl font-bold">{t('nav.myAppointments')}</h1>

      {appointments.length === 0 ? (
        <p className="mt-6 text-gray-500">
          {locale === 'ar' ? 'لا توجد مواعيد بعد.' : 'Aucun rendez-vous pour le moment.'}
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
          {appointments.map((a) => {
            // Only a future, still-live appointment can be cancelled — mirrors
            // the server-side rule in lifecycle.ts rather than guessing.
            const cancellable = !a.isPast && ['REQUESTED', 'CONFIRMED'].includes(a.status);
            return (
              <li key={a.id} className="flex items-start justify-between gap-4 p-4">
                <div>
                  <p className="font-medium">{a.counterpartyName}</p>
                  <p className="mt-0.5 text-sm text-gray-600">{a.whenLabel}</p>
                  <p className="text-sm text-gray-400">{a.clinicName}</p>
                  <div className="mt-2">
                    <AppointmentStatusBadge status={a.status} locale={locale} />
                  </div>
                </div>
                {cancellable && <CancelButton appointmentId={a.id} locale={locale} />}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getCurrentActor } from '@/lib/auth/session';
import { getDoctorAppointments } from '@/lib/booking/queries';
import { AppointmentStatusBadge } from '@/components/AppointmentStatusBadge';
import { AppointmentActions } from './AppointmentActions';

export const dynamic = 'force-dynamic';

export default async function DoctorSchedulePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations();

  const actor = await getCurrentActor();
  if (!actor) redirect(`/${locale}/login`);

  const appointments = await getDoctorAppointments(actor.userId, locale);
  const pending = appointments.filter((a) => a.status === 'REQUESTED');
  const ar = locale === 'ar';

  return (
    <section>
      <h1 className="text-2xl font-bold">{t('spaces.doctor')}</h1>

      {/* Vetted bookings (§13.2) sit idle until acted on, so surface the
          backlog rather than burying it in a chronological list. */}
      {pending.length > 0 && (
        <p className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {ar
            ? `${pending.length} طلب موعد بانتظار تأكيدك.`
            : `${pending.length} demande(s) en attente de confirmation.`}
        </p>
      )}

      {appointments.length === 0 ? (
        <p className="mt-6 text-gray-500">
          {ar ? 'لا توجد مواعيد.' : 'Aucun rendez-vous.'}
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
          {appointments.map((a) => (
            <li key={a.id} className="flex items-start justify-between gap-4 p-4">
              <div>
                <p className="font-medium">{a.counterpartyName}</p>
                <p className="mt-0.5 text-sm text-gray-600">{a.whenLabel}</p>
                <p className="text-sm text-gray-400">{a.clinicName}</p>
                <div className="mt-2">
                  <AppointmentStatusBadge status={a.status} locale={locale} />
                </div>
              </div>
              <AppointmentActions
                appointmentId={a.id}
                status={a.status}
                isPast={a.isPast}
                locale={locale}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

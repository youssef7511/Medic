import { notFound } from 'next/navigation';
import { DateTime } from 'luxon';
import { getTranslations } from 'next-intl/server';
import { prisma } from '@/lib/db';
import { getAvailability } from '@/lib/booking/availability';
import { HORIZON_DAYS } from '@/lib/booking/policy';
import { localeNumberingSystem, type Locale } from '@/i18n/config';
import { BookingForm, type SlotView } from './BookingForm';

export const dynamic = 'force-dynamic';

const DAYS_SHOWN = 14;

export default async function BookPage({
  params,
}: {
  params: Promise<{ doctorId: string; locale: string }>;
}) {
  const { doctorId, locale } = await params;
  const t = await getTranslations();

  const doctor = await prisma.doctorProfile.findFirst({
    where: { id: doctorId, isPublished: true },
    include: { clinics: true, specialty: true },
  });
  if (!doctor) notFound();

  const clinic = doctor.clinics[0];
  if (!clinic) {
    return (
      <section>
        <h1 className="text-2xl font-bold">{t('common.book')}</h1>
        <p className="mt-6 text-gray-500">
          This doctor has no clinic configured yet.
        </p>
      </section>
    );
  }

  const now = new Date();
  const to = new Date(now.getTime() + Math.min(DAYS_SHOWN, HORIZON_DAYS) * 86_400_000);

  const slots = await getAvailability({
    doctorId: doctor.id,
    clinicId: clinic.id,
    from: now,
    to,
    now,
  });

  // Format server-side in the DOCTOR's timezone (§6) — the appointment is at
  // the clinic, so a patient travelling abroad must still see clinic-local
  // times. §13.5: digits follow the locale's numbering system.
  const numberingSystem = localeNumberingSystem[locale as Locale] ?? 'latn';
  const intlLocale = `${locale}-u-nu-${numberingSystem}`;

  const slotViews: SlotView[] = slots.map((s) => {
    const dt = DateTime.fromJSDate(s.startAt).setZone(doctor.timezone).setLocale(intlLocale);
    return {
      startAt: s.startAt.toISOString(),
      dayLabel: dt.toLocaleString({ weekday: 'long', day: 'numeric', month: 'long' }),
      timeLabel: dt.toLocaleString({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
    };
  });

  const headline = (doctor.headline as Record<Locale, string>)?.[locale as Locale] ?? doctor.slug;

  return (
    <section>
      <h1 className="text-2xl font-bold">{t('common.book')}</h1>
      <p className="mt-1 text-gray-600">{headline}</p>
      <p className="mt-1 text-sm text-gray-500">{clinic.name}</p>

      <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        {t('safety.notForEmergencies')}
      </div>

      <div className="mt-8">
        <BookingForm doctorId={doctor.id} clinicId={clinic.id} slots={slotViews} />
      </div>
    </section>
  );
}

import { notFound } from 'next/navigation';
import { DateTime } from 'luxon';
import { getTranslations } from 'next-intl/server';
import { prisma } from '@/lib/db';
import { getAvailability } from '@/lib/booking/availability';
import { HORIZON_DAYS } from '@/lib/booking/policy';
import { localeNumberingSystem, type Locale } from '@/i18n/config';
import { BookingForm, type SlotView } from './BookingForm';
import { AlertTriangle, CalendarDays, MapPin, ShieldCheck, Stethoscope } from 'lucide-react';

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
  const specialty = (doctor.specialty.name as Record<Locale, string>)?.[locale as Locale] ?? '';
  const ar = locale === 'ar';

  return (
    <section className="max-w-5xl">
      <div><p className="medic-kicker">{ar ? 'الحجز عبر الإنترنت' : 'Réservation en ligne'}</p><h1 className="medic-page-title mt-2">{t('common.book')}</h1><p className="mt-2 text-sm text-slate-500">{ar ? 'اختر أحد المواعيد المتاحة وأرسل طلبك.' : 'Choisissez un créneau disponible et envoyez votre demande.'}</p></div>

      <div className="mt-7 grid items-start gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="space-y-4 lg:sticky lg:top-24">
          <div className="medic-panel p-5"><span className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-brand-700"><Stethoscope className="h-7 w-7" /></span><h2 className="mt-4 font-bold text-navy-950">{headline}</h2><p className="mt-1 text-sm font-medium text-brand-700">{specialty}</p><div className="mt-4 flex items-start gap-2 border-t border-slate-100 pt-4 text-xs leading-5 text-slate-500"><MapPin className="mt-0.5 h-4 w-4 shrink-0" /><span>{clinic.name}</span></div><p className="mt-3 flex items-start gap-2 text-xs leading-5 text-slate-500"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />{ar ? 'ملف طبي تم التحقق منه' : 'Profil médical vérifié'}</p></div>
          <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{t('safety.notForEmergencies')}</div>
        </aside>

        <div className="medic-panel overflow-hidden">
          <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4"><span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700"><CalendarDays className="h-5 w-5" /></span><div><h2 className="text-sm font-bold text-navy-950">{ar ? 'اختر التاريخ والوقت' : 'Choisir la date et l’heure'}</h2><p className="mt-0.5 text-xs text-slate-500">{ar ? 'المواعيد معروضة بتوقيت العيادة.' : 'Les horaires sont affichés dans le fuseau du cabinet.'}</p></div></div>
          <div className="p-5 sm:p-6"><BookingForm doctorId={doctor.id} clinicId={clinic.id} slots={slotViews} /></div>
        </div>
      </div>
    </section>
  );
}

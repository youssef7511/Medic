import { redirect } from 'next/navigation';
import { DateTime } from 'luxon';
import { prisma } from '@/lib/db';
import { getCurrentActor } from '@/lib/auth/session';
import { hasPermission } from '@/lib/rbac/guard';
import { AvailabilityEditor, type ExceptionView, type RuleView } from './AvailabilityEditor';

export const dynamic = 'force-dynamic';

export default async function AvailabilityPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const ar = locale === 'ar';

  const actor = await getCurrentActor();
  if (!actor) redirect(`/${locale}/login`);

  // Editing hours is the doctor's own configuration — staff can view the
  // calendar but not rewrite the practice's schedule (§5).
  if (!hasPermission(actor, 'doctor_profile:edit:own')) redirect(`/${locale}/d`);

  const doctor = await prisma.doctorProfile.findUnique({
    where: { userId: actor.userId },
    select: {
      id: true,
      timezone: true,
      clinics: { select: { id: true, name: true } },
    },
  });

  if (!doctor) {
    return (
      <section>
        <h1 className="text-2xl font-bold">{ar ? 'ساعات العمل' : 'Disponibilités'}</h1>
        <p className="mt-4 text-gray-500">
          {ar
            ? 'هذا الحساب غير مرتبط بملف طبيب.'
            : "Ce compte n'est pas associé à un profil médecin."}
        </p>
      </section>
    );
  }

  const [rules, exceptions] = await Promise.all([
    prisma.availabilityRule.findMany({
      where: { doctorId: doctor.id },
      orderBy: [{ weekday: 'asc' }, { startLocal: 'asc' }],
    }),
    prisma.availabilityException.findMany({
      where: { doctorId: doctor.id, date: { gte: new Date() } },
      orderBy: { date: 'asc' },
      take: 50,
    }),
  ]);

  const clinicNames = new Map(doctor.clinics.map((c) => [c.id, c.name]));

  const ruleViews: RuleView[] = rules.map((r) => ({
    id: r.id,
    weekday: r.weekday,
    startLocal: r.startLocal,
    endLocal: r.endLocal,
    slotMinutes: r.slotMinutes,
    clinicName: clinicNames.get(r.clinicId) ?? '—',
  }));

  const exceptionViews: ExceptionView[] = exceptions.map((e) => ({
    id: e.id,
    // @db.Date: read as a bare calendar date, never shifted into a local zone.
    date: DateTime.fromJSDate(e.date, { zone: 'utc' }).toISODate() ?? '',
    isClosed: e.isClosed,
    startLocal: e.startLocal,
    endLocal: e.endLocal,
  }));

  return (
    <section>
      <h1 className="text-2xl font-bold">{ar ? 'ساعات العمل' : 'Disponibilités'}</h1>
      <p className="mb-6 mt-1 text-sm text-gray-500">
        {ar ? 'المنطقة الزمنية' : 'Fuseau horaire'}: {doctor.timezone}
      </p>

      <AvailabilityEditor
        rules={ruleViews}
        exceptions={exceptionViews}
        clinics={doctor.clinics}
        locale={locale}
      />
    </section>
  );
}

/**
 * Fills the CURRENT week with fictional appointments for the UI-fixture doctor,
 * so the calendar has something to look at.
 *
 * Non-destructive by design: it only clears this doctor's appointments inside
 * the visible week, and reuses existing patients/links. Safe to re-run, and it
 * leaves login credentials (from .claude/skills/run-medic/fixtures.ts) intact.
 */
import { DateTime } from 'luxon';
import { AppointmentStatus, LinkSource, PrismaClient, Role, ScopeType, Sex } from '@prisma/client';
import { hashPassword } from '../src/lib/auth/password';

const prisma = new PrismaClient();
const SLUG = process.env.DEMO_DOCTOR_SLUG ?? 'dr-ui-demo';

const PEOPLE: [string, string, Sex][] = [
  ['Amina', 'Trabelsi', Sex.FEMALE],
  ['Karim', 'Gharbi', Sex.MALE],
  ['Leila', 'Mansouri', Sex.FEMALE],
  ['Youssef', 'Chaabane', Sex.MALE],
  ['Nadia', 'Ben Salah', Sex.FEMALE],
  ['Hedi', 'Jelassi', Sex.MALE],
];

async function main() {
  const doctor = await prisma.doctorProfile.findUnique({
    where: { slug: SLUG },
    select: { id: true, timezone: true, clinics: { select: { id: true, name: true } } },
  });
  if (!doctor) throw new Error(`No doctor with slug "${SLUG}" — run fixtures.ts seed first.`);

  const primary = doctor.clinics[0];
  if (!primary) throw new Error('Doctor has no clinic.');
  // A second clinic lets us show a genuine cross-clinic clash; the exclusion
  // constraint is per-clinic, so this is legal in the DB and worth surfacing.
  const secondary =
    doctor.clinics[1] ??
    (await prisma.clinic.create({
      data: {
        doctorId: doctor.id,
        name: 'Clinique El Manar',
        address: { line1: '3 rue Ibn Sina', city: 'Tunis', country: 'TN' },
      },
      select: { id: true, name: true },
    }));

  // Ensure enough patients exist, linked to this doctor.
  const links = [];
  for (const [i, [firstName, lastName, sex]] of PEOPLE.entries()) {
    const email = `demo.patient${i}@medic.test`;
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        phone: `+2162100000${i}`,
        locale: i % 3 === 0 ? 'ar' : 'fr',
        passwordHash: await hashPassword('correct-horse-battery-staple'),
      },
    });

    const patient =
      (await prisma.patientProfile.findUnique({ where: { userId: user.id } })) ??
      (await prisma.patientProfile.create({
        data: {
          userId: user.id,
          firstName,
          lastName,
          dateOfBirth: new Date(`19${70 + i}-0${(i % 9) + 1}-15`),
          sex,
          phone: `+2162100000${i}`,
        },
      }));

    // Not an upsert: the compound unique includes a nullable scopeId, and
    // Prisma rejects null inside a `where` on a compound unique.
    const hasRole = await prisma.roleAssignment.findFirst({
      where: { userId: user.id, role: Role.PATIENT },
      select: { id: true },
    });
    if (!hasRole) {
      await prisma.roleAssignment.create({
        data: {
          userId: user.id,
          role: Role.PATIENT,
          scopeType: ScopeType.GLOBAL,
          grantedBy: 'demo-week',
        },
      });
    }

    links.push(
      await prisma.patientDoctorLink.upsert({
        where: { patientId_doctorId: { patientId: patient.id, doctorId: doctor.id } },
        update: {},
        create: { patientId: patient.id, doctorId: doctor.id, source: LinkSource.BOOKING },
      }),
    );
  }

  const monday = DateTime.now().setZone(doctor.timezone).startOf('week');
  const weekEnd = monday.plus({ days: 7 });

  // Clear only this week for this doctor, so re-runs stay idempotent.
  await prisma.appointment.deleteMany({
    where: {
      link: { doctorId: doctor.id },
      startAt: { gte: monday.toJSDate(), lt: weekEnd.toJSDate() },
    },
  });

  const plan: [number, string, number, 'a' | 'b', AppointmentStatus][] = [
    [0, '09:00', 30, 'a', AppointmentStatus.CONFIRMED],
    [0, '09:30', 30, 'a', AppointmentStatus.CONFIRMED],
    [0, '10:30', 30, 'a', AppointmentStatus.REQUESTED],
    [0, '15:00', 45, 'b', AppointmentStatus.CONFIRMED],
    [0, '15:15', 45, 'a', AppointmentStatus.REQUESTED], // cross-clinic clash
    [1, '09:00', 30, 'a', AppointmentStatus.CONFIRMED],
    [1, '11:00', 30, 'a', AppointmentStatus.NO_SHOW],
    [2, '09:30', 30, 'a', AppointmentStatus.CONFIRMED],
    [2, '16:30', 45, 'b', AppointmentStatus.CONFIRMED],
    [3, '10:00', 30, 'a', AppointmentStatus.REQUESTED],
    [3, '12:00', 30, 'a', AppointmentStatus.CONFIRMED],
    [4, '09:00', 30, 'a', AppointmentStatus.COMPLETED],
    [4, '10:00', 30, 'a', AppointmentStatus.CONFIRMED],
  ];

  let created = 0;
  for (const [i, [dayOffset, time, duration, clinicKey, status]] of plan.entries()) {
    const [h, m] = time.split(':').map(Number);
    const start = monday.plus({ days: dayOffset }).set({
      hour: h,
      minute: m,
      second: 0,
      millisecond: 0,
    });
    await prisma.appointment.create({
      data: {
        linkId: links[i % links.length]!.id,
        clinicId: clinicKey === 'a' ? primary.id : secondary.id,
        startAt: start.toJSDate(),
        endAt: start.plus({ minutes: duration }).toJSDate(),
        status,
      },
    });
    created++;
  }

  // A closed day later in the week.
  const holiday = new Date(`${monday.plus({ days: 5 }).toISODate()}T00:00:00Z`);
  const existing = await prisma.availabilityException.findFirst({
    where: { doctorId: doctor.id, date: holiday },
  });
  if (!existing) {
    await prisma.availabilityException.create({
      data: { doctorId: doctor.id, date: holiday, isClosed: true },
    });
  }

  console.log(`Populated ${created} appointments for ${SLUG}, week of ${monday.toISODate()}.`);
}

main()
  .catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

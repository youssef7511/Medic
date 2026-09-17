/**
 * Demo fixtures for reviewing the doctor calendar. Fictional data only.
 * Destructive — wipes and reseeds. Never point at real data.
 */
import { DateTime } from 'luxon';
import { AppointmentStatus, LinkSource, PrismaClient, Role, ScopeType, Sex } from '@prisma/client';
import { hashPassword } from '../src/lib/auth/password';
import { generateMfaSecret } from '../src/lib/auth/totp';

const prisma = new PrismaClient();
const TZ = 'Africa/Tunis';

export const DEMO = {
  email: 'dr.demo@medic.test',
  password: 'demo-password-1234',
};

async function main() {
  await prisma.outboxMessage.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.appointment.deleteMany();
  await prisma.patientDoctorLink.deleteMany();
  await prisma.availabilityException.deleteMany();
  await prisma.availabilityRule.deleteMany();
  await prisma.clinic.deleteMany();
  await prisma.roleAssignment.deleteMany();
  await prisma.doctorProfile.deleteMany();
  await prisma.patientProfile.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await prisma.specialty.deleteMany();

  const specialty = await prisma.specialty.create({
    data: { slug: 'cardiology', name: { fr: 'Cardiologie', ar: 'أمراض القلب' } },
  });

  const mfaSecret = generateMfaSecret();
  const doctorUser = await prisma.user.create({
    data: {
      email: DEMO.email,
      phone: '+21610000001',
      locale: 'fr',
      passwordHash: await hashPassword(DEMO.password),
      mfaSecret,
    },
  });

  const doctor = await prisma.doctorProfile.create({
    data: {
      userId: doctorUser.id,
      slug: 'dr-amine-benali',
      specialtyId: specialty.id,
      licenseNumber: 'TN-2019-4471',
      bio: { fr: 'Cardiologue', ar: 'طبيب قلب' },
      headline: { fr: 'Dr Amine Benali', ar: 'د. أمين بن علي' },
      languages: ['fr', 'ar'],
      isPublished: true,
      timezone: TZ,
    },
  });

  await prisma.roleAssignment.create({
    data: { userId: doctorUser.id, role: Role.DOCTOR, scopeType: ScopeType.GLOBAL, grantedBy: 'demo' },
  });

  const central = await prisma.clinic.create({
    data: {
      doctorId: doctor.id,
      name: 'Cabinet Centre-Ville',
      address: { line1: '12 av. Habib Bourguiba', city: 'Tunis', country: 'TN' },
    },
  });
  const annex = await prisma.clinic.create({
    data: {
      doctorId: doctor.id,
      name: 'Clinique El Manar',
      address: { line1: '3 rue Ibn Sina', city: 'Tunis', country: 'TN' },
    },
  });

  // Mon–Fri mornings + Mon/Wed afternoons.
  for (const weekday of [1, 2, 3, 4, 5]) {
    await prisma.availabilityRule.create({
      data: {
        doctorId: doctor.id,
        clinicId: central.id,
        weekday,
        startLocal: '09:00',
        endLocal: '13:00',
        slotMinutes: 30,
        validFrom: new Date('2020-01-01T00:00:00Z'),
      },
    });
  }
  for (const weekday of [1, 3]) {
    await prisma.availabilityRule.create({
      data: {
        doctorId: doctor.id,
        clinicId: annex.id,
        weekday,
        startLocal: '15:00',
        endLocal: '18:00',
        slotMinutes: 45,
        validFrom: new Date('2020-01-01T00:00:00Z'),
      },
    });
  }

  const people: [string, string, Sex][] = [
    ['Amina', 'Trabelsi', Sex.FEMALE],
    ['Karim', 'Gharbi', Sex.MALE],
    ['Leila', 'Mansouri', Sex.FEMALE],
    ['Youssef', 'Chaabane', Sex.MALE],
    ['Nadia', 'Ben Salah', Sex.FEMALE],
    ['Hedi', 'Jelassi', Sex.MALE],
  ];

  const links = [];
  for (const [i, [firstName, lastName, sex]] of people.entries()) {
    const u = await prisma.user.create({
      data: {
        email: `patient${i}@medic.test`,
        phone: `+2162000000${i}`,
        locale: i % 3 === 0 ? 'ar' : 'fr',
        passwordHash: await hashPassword('patient-password-1234'),
      },
    });
    const p = await prisma.patientProfile.create({
      data: {
        userId: u.id,
        firstName,
        lastName,
        dateOfBirth: new Date(`19${70 + i}-0${(i % 9) + 1}-15`),
        sex,
        phone: `+2162000000${i}`,
      },
    });
    await prisma.roleAssignment.create({
      data: { userId: u.id, role: Role.PATIENT, scopeType: ScopeType.GLOBAL, grantedBy: 'demo' },
    });
    links.push(
      await prisma.patientDoctorLink.create({
        data: { patientId: p.id, doctorId: doctor.id, source: LinkSource.BOOKING },
      }),
    );
  }

  // Appointments across the CURRENT week so the default view is populated.
  const monday = DateTime.now().setZone(TZ).startOf('week');

  const plan: [number, string, number, string, AppointmentStatus][] = [
    // [dayOffset, time, durationMin, clinic, status]
    [0, '09:00', 30, 'central', AppointmentStatus.CONFIRMED],
    [0, '09:30', 30, 'central', AppointmentStatus.CONFIRMED],
    [0, '10:30', 30, 'central', AppointmentStatus.REQUESTED],
    [0, '15:00', 45, 'annex', AppointmentStatus.CONFIRMED],
    // Cross-clinic conflict — the doctor cannot be in two places at 15:15.
    // The exclusion constraint is per-clinic, so this is exactly the kind of
    // clash the calendar needs to make visible.
    [0, '15:15', 45, 'central', AppointmentStatus.REQUESTED],
    [1, '09:00', 30, 'central', AppointmentStatus.CONFIRMED],
    [1, '11:00', 30, 'central', AppointmentStatus.NO_SHOW],
    [2, '09:30', 30, 'central', AppointmentStatus.CONFIRMED],
    [2, '16:30', 45, 'annex', AppointmentStatus.CONFIRMED],
    [3, '10:00', 30, 'central', AppointmentStatus.REQUESTED],
    [3, '12:00', 30, 'central', AppointmentStatus.CONFIRMED],
    [4, '09:00', 30, 'central', AppointmentStatus.COMPLETED],
    [4, '10:00', 30, 'central', AppointmentStatus.CONFIRMED],
  ];

  for (const [i, [dayOffset, time, duration, clinicKey, status]] of plan.entries()) {
    const start = monday.plus({ days: dayOffset }).set({
      hour: Number(time.split(':')[0]),
      minute: Number(time.split(':')[1]),
      second: 0,
      millisecond: 0,
    });
    await prisma.appointment.create({
      data: {
        linkId: links[i % links.length]!.id,
        clinicId: clinicKey === 'central' ? central.id : annex.id,
        startAt: start.toJSDate(),
        endAt: start.plus({ minutes: duration }).toJSDate(),
        status,
      },
    });
  }

  // A closed day (public holiday) later in the week.
  await prisma.availabilityException.create({
    data: {
      doctorId: doctor.id,
      date: new Date(`${monday.plus({ days: 5 }).toISODate()}T00:00:00Z`),
      isClosed: true,
    },
  });

  console.log(JSON.stringify({ email: DEMO.email, password: DEMO.password, mfaSecret }));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

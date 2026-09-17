/**
 * End-to-end exercise of the booking flow against a REAL Postgres.
 *
 * Unit tests cover the pure logic; this covers everything they structurally
 * can't — the exclusion constraint, transactional rollback, the outbox, and
 * whether the whole stack agrees with itself. Run with:
 *
 *   docker start medic-pg
 *   DATABASE_URL=... npx tsx scripts/e2e-booking.ts
 *
 * Destructive: truncates its own fixtures. Never point it at real data.
 */
import { DateTime } from 'luxon';
import {
  AppointmentStatus,
  LinkSource,
  PrismaClient,
  Role,
  ScopeType,
  Sex,
} from '@prisma/client';
import { getAvailability } from '../src/lib/booking/availability';
import { bookAppointment, SlotUnavailableError } from '../src/lib/booking/book';
import { cancelAppointment, confirmAppointment } from '../src/lib/booking/lifecycle';
import { TOPICS } from '../src/lib/notifications/schedule';
import type { Actor } from '../src/lib/rbac/guard';

const prisma = new PrismaClient();
const TZ = 'Africa/Tunis';

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail = '') {
  if (condition) {
    console.log(`  ✔ ${label}`);
    passed++;
  } else {
    console.error(`  �’ ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

async function reset() {
  // Order matters: children before parents.
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
}

async function seed() {
  const specialty = await prisma.specialty.create({
    data: { slug: 'general-medicine', name: { fr: 'Médecine générale', ar: 'الطب العام' } },
  });

  const doctorUser = await prisma.user.create({
    data: { email: 'dr.test@example.com', phone: '+21610000001', locale: 'fr' },
  });

  const doctor = await prisma.doctorProfile.create({
    data: {
      userId: doctorUser.id,
      slug: 'dr-test',
      specialtyId: specialty.id,
      licenseNumber: 'TEST-001',
      bio: { fr: 'Bio', ar: 'نبذة' },
      headline: { fr: 'Dr Test', ar: 'د. تست' },
      languages: ['fr', 'ar'],
      isPublished: true,
      autoConfirm: false, // §13.2 default: vetted
      timezone: TZ,
    },
  });

  await prisma.roleAssignment.create({
    data: {
      userId: doctorUser.id,
      role: Role.DOCTOR,
      scopeType: ScopeType.GLOBAL,
      grantedBy: 'e2e',
    },
  });

  const clinic = await prisma.clinic.create({
    data: {
      doctorId: doctor.id,
      name: 'Cabinet Centre',
      address: { line1: '1 rue Test', city: 'Tunis', country: 'TN' },
    },
  });

  // Availability every weekday 09:00–12:00, 30-minute slots.
  for (let weekday = 0; weekday < 7; weekday++) {
    await prisma.availabilityRule.create({
      data: {
        doctorId: doctor.id,
        clinicId: clinic.id,
        weekday,
        startLocal: '09:00',
        endLocal: '12:00',
        slotMinutes: 30,
        validFrom: new Date('2020-01-01T00:00:00Z'),
      },
    });
  }

  const patientUser = await prisma.user.create({
    data: { email: 'patient@example.com', phone: '+21620000001', locale: 'fr' },
  });
  const patient = await prisma.patientProfile.create({
    data: {
      userId: patientUser.id,
      firstName: 'Amina',
      lastName: 'Test',
      dateOfBirth: new Date('1990-05-05'),
      sex: Sex.FEMALE,
      phone: '+21620000001',
    },
  });
  await prisma.roleAssignment.create({
    data: {
      userId: patientUser.id,
      role: Role.PATIENT,
      scopeType: ScopeType.GLOBAL,
      grantedBy: 'e2e',
    },
  });

  const secondUser = await prisma.user.create({
    data: { email: 'patient2@example.com', phone: '+21620000002', locale: 'ar' },
  });
  await prisma.patientProfile.create({
    data: {
      userId: secondUser.id,
      firstName: 'Karim',
      lastName: 'Test',
      dateOfBirth: new Date('1985-02-02'),
      sex: Sex.MALE,
      phone: '+21620000002',
    },
  });
  await prisma.roleAssignment.create({
    data: {
      userId: secondUser.id,
      role: Role.PATIENT,
      scopeType: ScopeType.GLOBAL,
      grantedBy: 'e2e',
    },
  });

  return { doctor, doctorUser, clinic, patient, patientUser, secondUser };
}

async function actorFor(userId: string): Promise<Actor> {
  const roles = await prisma.roleAssignment.findMany({ where: { userId } });
  return { userId, roles };
}

async function main() {
  console.log('\n=== Medic booking E2E ===\n');
  await reset();
  const fx = await seed();

  const now = new Date();
  const from = now;
  const to = new Date(now.getTime() + 14 * 86_400_000);

  // ---------------------------------------------------------------- availability
  console.log('availability');
  const slots = await getAvailability({
    doctorId: fx.doctor.id,
    clinicId: fx.clinic.id,
    from,
    to,
    now,
  });
  check('derives slots from rules against a real DB', slots.length > 0, `got ${slots.length}`);

  const first = slots[0]!;
  const localHour = DateTime.fromJSDate(first.startAt).setZone(TZ).hour;
  check('slot lands inside the doctor local window (09–12)', localHour >= 9 && localHour < 12,
    `hour=${localHour}`);

  // ---------------------------------------------------------------------- book
  console.log('\nbooking');
  const patientActor = await actorFor(fx.patientUser.id);
  const appointment = await bookAppointment({
    userId: fx.patientUser.id,
    doctorId: fx.doctor.id,
    clinicId: fx.clinic.id,
    startAt: first.startAt,
    reason: 'Toux persistante',
  });

  check('appointment created', !!appointment.id);
  check('doctor-vetted default → REQUESTED (§13.2)',
    appointment.status === AppointmentStatus.REQUESTED, appointment.status);

  const link = await prisma.patientDoctorLink.findFirst({
    where: { patientId: fx.patient.id, doctorId: fx.doctor.id },
  });
  check('PatientDoctorLink created on first booking (§2)', !!link);
  check('link source is BOOKING', link?.source === LinkSource.BOOKING);

  check('reason-for-visit stored encrypted, not plaintext (§3.1)',
    !!appointment.reasonEnc &&
      !Buffer.from(appointment.reasonEnc).toString('utf8').includes('Toux'));

  const afterBook = await prisma.outboxMessage.findMany({
    where: { payload: { path: ['appointmentId'], equals: appointment.id } },
  });
  const bookTopics = afterBook.map((m) => m.topic).sort();
  check('outbox: acknowledgement + doctor alert, NO reminders yet',
    bookTopics.join(',') === [TOPICS.doctorNewRequest, TOPICS.requestReceived].sort().join(','),
    bookTopics.join(','));

  const bookAudit = await prisma.auditLog.findFirst({
    where: { action: 'appointment.book', resourceId: appointment.id },
  });
  check('audit row written for the booking (§10)', !!bookAudit);
  check('audit row carries patientId for "who touched this patient"',
    bookAudit?.patientId === fx.patient.id);

  // slot disappears from availability
  const afterSlots = await getAvailability({
    doctorId: fx.doctor.id, clinicId: fx.clinic.id, from, to, now,
  });
  check('booked slot no longer offered',
    !afterSlots.some((s) => s.startAt.getTime() === first.startAt.getTime()));

  // ------------------------------------------------------ same slot, second try
  console.log('\ndouble-booking');
  let rejected = false;
  try {
    await bookAppointment({
      userId: fx.secondUser.id,
      doctorId: fx.doctor.id,
      clinicId: fx.clinic.id,
      startAt: first.startAt,
    });
  } catch (e) {
    rejected = e instanceof SlotUnavailableError;
  }
  check('sequential double-booking rejected', rejected);

  // The real test: two concurrent bookings racing for one slot. The app-level
  // availability check cannot arbitrate this — only the DB constraint can.
  const raceSlot = afterSlots[0]!;
  const results = await Promise.allSettled([
    bookAppointment({
      userId: fx.patientUser.id, doctorId: fx.doctor.id,
      clinicId: fx.clinic.id, startAt: raceSlot.startAt,
    }),
    bookAppointment({
      userId: fx.secondUser.id, doctorId: fx.doctor.id,
      clinicId: fx.clinic.id, startAt: raceSlot.startAt,
    }),
  ]);
  const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
  const heldRows = await prisma.appointment.count({
    where: {
      clinicId: fx.clinic.id,
      startAt: raceSlot.startAt,
      status: { in: [AppointmentStatus.REQUESTED, AppointmentStatus.CONFIRMED] },
    },
  });
  check('concurrent race → exactly one winner', fulfilled === 1, `fulfilled=${fulfilled}`);
  check('exclusion constraint left exactly one live row', heldRows === 1, `rows=${heldRows}`);

  // ------------------------------------------------------------------- confirm
  console.log('\nconfirm');
  const doctorActor = await actorFor(fx.doctorUser.id);
  await confirmAppointment({ actor: doctorActor, appointmentId: appointment.id });

  const confirmed = await prisma.appointment.findUnique({ where: { id: appointment.id } });
  check('status → CONFIRMED', confirmed?.status === AppointmentStatus.CONFIRMED);

  const afterConfirm = await prisma.outboxMessage.findMany({
    where: {
      payload: { path: ['appointmentId'], equals: appointment.id },
      topic: TOPICS.reminder,
    },
  });
  check('reminders scheduled only on confirmation', afterConfirm.length > 0,
    `count=${afterConfirm.length}`);
  check('reminders are in the future',
    afterConfirm.every((m) => m.scheduledFor.getTime() > Date.now()));

  // -------------------------------------------------------------------- cancel
  console.log('\ncancel');
  await cancelAppointment({
    actor: patientActor,
    appointmentId: appointment.id,
    reason: 'Empêchement',
  });

  const cancelled = await prisma.appointment.findUnique({ where: { id: appointment.id } });
  check('status → CANCELLED', cancelled?.status === AppointmentStatus.CANCELLED);

  const pendingReminders = await prisma.outboxMessage.count({
    where: {
      payload: { path: ['appointmentId'], equals: appointment.id },
      topic: TOPICS.reminder,
      status: 'PENDING',
    },
  });
  check('pending reminders killed on cancellation', pendingReminders === 0,
    `still pending=${pendingReminders}`);

  const freed = await getAvailability({
    doctorId: fx.doctor.id, clinicId: fx.clinic.id, from, to, now,
  });
  check('cancelling frees the slot again',
    freed.some((s) => s.startAt.getTime() === first.startAt.getTime()));

  // ------------------------------------------------------------ authorization
  console.log('\nauthorization (§5)');
  const strangerActor = await actorFor(fx.secondUser.id);
  let denied = false;
  try {
    await cancelAppointment({
      actor: strangerActor,
      appointmentId: (await prisma.appointment.findFirstOrThrow({
        where: { link: { patientId: fx.patient.id } },
      })).id,
    });
  } catch (e) {
    denied = (e as Error).name === 'ResourceNotFoundError';
  }
  check("another patient cannot cancel someone else's appointment (404, not 403)", denied);

  // ------------------------------------------------------------------- summary
  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('E2E crashed:', e);
  await prisma.$disconnect();
  process.exit(1);
});

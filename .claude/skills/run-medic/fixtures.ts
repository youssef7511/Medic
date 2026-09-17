/**
 * UI fixtures for driving Medic through a browser.
 *
 * The existing `scripts/e2e-booking.ts` exercises the DOMAIN layer and creates
 * users with NO passwordHash — nothing it makes can log in. This script fills
 * that gap: accounts with known passwords (and a known TOTP secret for the
 * doctor, whose role makes 2FA mandatory, §10) so playwright-cli can sign in
 * and click through the real app.
 *
 * Idempotent by design — unlike e2e-booking.ts it upserts and never truncates,
 * so it is safe to re-run against a dev DB you care about.
 *
 * Usage (from repo root, DATABASE_URL exported):
 *   npx tsx .claude/skills/run-medic/fixtures.ts seed
 *   npx tsx .claude/skills/run-medic/fixtures.ts totp     # current doctor code
 *   npx tsx .claude/skills/run-medic/fixtures.ts show     # credentials + state
 */
import { authenticator } from 'otplib';
import { hash } from 'bcryptjs';
import { PrismaClient, Role, ScopeType, Sex } from '@prisma/client';

const prisma = new PrismaClient();

export const PATIENT_EMAIL = 'patient.ui@medic.test';
export const DOCTOR_EMAIL = 'doctor.ui@medic.test';
export const PASSWORD = 'correct-horse-battery-staple';

// Fixed so `totp` can regenerate codes across runs without touching the DB.
export const DOCTOR_MFA_SECRET = 'KRSXG5CTMVRXEZLUKMFA4TSNJVQWY3DP';

const TZ = 'Africa/Tunis';
const DOCTOR_SLUG = 'dr-ui-demo';

async function seed() {
  const passwordHash = await hash(PASSWORD, 12);

  const specialty = await prisma.specialty.upsert({
    where: { slug: 'general-medicine' },
    update: {},
    create: {
      slug: 'general-medicine',
      name: { fr: 'Médecine générale', ar: 'الطب العام' },
    },
  });

  // ---------------------------------------------------------------- patient
  // No MFA: patients are exempt (§10), so this account logs in with one POST.
  const patientUser = await prisma.user.upsert({
    where: { email: PATIENT_EMAIL },
    update: { passwordHash, status: 'ACTIVE' },
    create: { email: PATIENT_EMAIL, phone: '+21620009001', passwordHash, locale: 'fr' },
  });

  await prisma.patientProfile.upsert({
    where: { userId: patientUser.id },
    update: {},
    create: {
      userId: patientUser.id,
      firstName: 'Amina',
      lastName: 'Demo',
      dateOfBirth: new Date('1990-05-05'),
      sex: Sex.FEMALE,
      phone: '+21620009001',
    },
  });

  await ensureRole(patientUser.id, Role.PATIENT);

  // ----------------------------------------------------------------- doctor
  // mfaSecret is stored as plaintext base32 (it is not envelope-encrypted),
  // so a fixed secret here is enough to compute valid codes.
  const doctorUser = await prisma.user.upsert({
    where: { email: DOCTOR_EMAIL },
    update: { passwordHash, mfaSecret: DOCTOR_MFA_SECRET, status: 'ACTIVE' },
    create: {
      email: DOCTOR_EMAIL,
      phone: '+21610009001',
      passwordHash,
      mfaSecret: DOCTOR_MFA_SECRET,
      locale: 'fr',
    },
  });

  const doctor = await prisma.doctorProfile.upsert({
    where: { userId: doctorUser.id },
    update: { isPublished: true },
    create: {
      userId: doctorUser.id,
      slug: DOCTOR_SLUG,
      specialtyId: specialty.id,
      licenseNumber: 'UI-DEMO-001',
      bio: { fr: 'Médecin de démonstration.', ar: 'طبيب تجريبي.' },
      headline: { fr: 'Dr UI Demo', ar: 'د. واجهة' },
      languages: ['fr', 'ar'],
      isPublished: true, // else it never appears in /fr/doctors
      autoConfirm: false,
      timezone: TZ,
    },
  });

  await ensureRole(doctorUser.id, Role.DOCTOR);

  // ------------------------------------------------------- clinic + slots
  let clinic = await prisma.clinic.findFirst({ where: { doctorId: doctor.id } });
  if (!clinic) {
    clinic = await prisma.clinic.create({
      data: {
        doctorId: doctor.id,
        name: 'Cabinet Demo',
        address: { line1: '1 rue Demo', city: 'Tunis', country: 'TN' },
      },
    });
  }

  // All 7 weekdays 09:00–12:00 so there is always a bookable slot regardless of
  // which day the driver runs. Booking lead time still applies (§6).
  const ruleCount = await prisma.availabilityRule.count({ where: { doctorId: doctor.id } });
  if (ruleCount === 0) {
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
  }

  await show();
}

async function ensureRole(userId: string, role: Role) {
  const existing = await prisma.roleAssignment.findFirst({ where: { userId, role } });
  if (!existing) {
    await prisma.roleAssignment.create({
      data: { userId, role, scopeType: ScopeType.GLOBAL, grantedBy: 'ui-fixtures' },
    });
  }
}

async function show() {
  const doctor = await prisma.doctorProfile.findFirst({
    where: { slug: DOCTOR_SLUG },
    include: { clinics: true, user: true },
  });

  console.log('\n--- Medic UI fixtures ---');
  console.log(`patient : ${PATIENT_EMAIL} / ${PASSWORD}   (no 2FA)`);
  console.log(`doctor  : ${DOCTOR_EMAIL} / ${PASSWORD}   (2FA required)`);
  console.log(`doctor TOTP now : ${authenticator.generate(DOCTOR_MFA_SECRET)}`);
  console.log(`doctor profile  : /fr/doctors/${DOCTOR_SLUG}`);
  console.log(`doctorId=${doctor?.id ?? '-'} clinicId=${doctor?.clinics[0]?.id ?? '-'}`);
  console.log(`published=${doctor?.isPublished} autoConfirm=${doctor?.autoConfirm}`);
  console.log('-------------------------\n');
}

const cmd = process.argv[2] ?? 'seed';

const run =
  cmd === 'totp'
    ? async () => console.log(authenticator.generate(DOCTOR_MFA_SECRET))
    : cmd === 'show'
      ? show
      : seed;

run()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

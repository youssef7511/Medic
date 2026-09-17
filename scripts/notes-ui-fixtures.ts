/**
 * Ensures the browser check for consultation notes has what it needs:
 *  - an ACTIVE link between the UI doctor and the UI patient (prints its id)
 *  - a DOCTOR_STAFF account scoped to that doctor, to prove §5 blocks clinical
 *    content for staff.
 * Idempotent; reuses the run-medic UI fixtures. Fictional data only.
 */
import { PrismaClient, Role, ScopeType, LinkSource } from '@prisma/client';
import { hashPassword } from '../src/lib/auth/password';

const prisma = new PrismaClient();
const STAFF_EMAIL = 'staff.ui@medic.test';
const STAFF_PASSWORD = 'correct-horse-battery-staple';

async function main() {
  const doctorUser = await prisma.user.findUniqueOrThrow({
    where: { email: 'doctor.ui@medic.test' },
    include: { doctorProfile: true },
  });
  const patient = await prisma.patientProfile.findFirstOrThrow({
    where: { user: { email: 'patient.ui@medic.test' } },
  });
  const doctorId = doctorUser.doctorProfile!.id;

  const link = await prisma.patientDoctorLink.upsert({
    where: { patientId_doctorId: { patientId: patient.id, doctorId } },
    update: {},
    create: { patientId: patient.id, doctorId, source: LinkSource.BOOKING },
  });

  // Staff account, scoped to this doctor. Requires MFA like every privileged
  // role (§10), so we set a fixed secret to keep the browser check scriptable.
  const staff = await prisma.user.upsert({
    where: { email: STAFF_EMAIL },
    update: {},
    create: {
      email: STAFF_EMAIL,
      locale: 'fr',
      passwordHash: await hashPassword(STAFF_PASSWORD),
      mfaSecret: 'KRSXG5CTMVRXEZLUKMFA4TSNJVQWY3DP', // same as doctor fixture
    },
  });
  const hasRole = await prisma.roleAssignment.findFirst({
    where: { userId: staff.id, role: Role.DOCTOR_STAFF },
  });
  if (!hasRole) {
    await prisma.roleAssignment.create({
      data: {
        userId: staff.id,
        role: Role.DOCTOR_STAFF,
        scopeType: ScopeType.DOCTOR,
        scopeId: doctorId,
        grantedBy: 'notes-ui-fixtures',
      },
    });
  }

  console.log(`linkId=${link.id}`);
  console.log(`staff=${STAFF_EMAIL} / ${STAFF_PASSWORD} (2FA required)`);
}

main()
  .catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

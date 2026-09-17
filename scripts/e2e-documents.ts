/**
 * Documents & prescriptions, end to end against real Postgres + MinIO.
 *
 * Covers what unit tests can't: storage round-trip + checksum, encryption at
 * rest, the issue/supersede/revoke lifecycle, per-read auditing, and
 * cross-party isolation.
 *
 * Self-seeds with unique ids, cleans up its own rows AND storage objects.
 * Never point at real data.
 *
 * Run: npm run db:up && npm run db:storage && npm run db:storage:bucket && npm run e2e:documents
 */
import { PrismaClient, Role, ScopeType, Sex, LinkSource } from '@prisma/client';
import {
  issuePrescription,
  supersedePrescription,
  revokeDocument,
  getDocumentForDownload,
  listDocuments,
  DocumentValidationError,
} from '../src/lib/documents/prescriptions';
import { ResourceNotFoundError, type Actor } from '../src/lib/rbac/guard';
import { encryptText, decryptText } from '../src/lib/crypto/envelope';
import { getObjectStore } from '../src/lib/storage';

const prisma = new PrismaClient();
let passed = 0;
let failed = 0;
const keysToClean: string[] = [];

function check(label: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? '✔' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  ok ? passed++ : failed++;
}

async function actorFor(userId: string): Promise<Actor> {
  const roles = await prisma.roleAssignment.findMany({ where: { userId } });
  return { userId, roles };
}

const stamp = Date.now();

async function mkDoctor(tag: string) {
  const specialty = await prisma.specialty.upsert({
    where: { slug: 'docs-e2e' },
    update: {},
    create: { slug: 'docs-e2e', name: { fr: 'Test', ar: 'اختبار' } },
  });
  const user = await prisma.user.create({
    data: { email: `docs-${tag}-${stamp}@e2e.test`, locale: 'fr' },
  });
  await prisma.roleAssignment.create({
    data: { userId: user.id, role: Role.DOCTOR, scopeType: ScopeType.GLOBAL, grantedBy: 'e2e' },
  });
  const profile = await prisma.doctorProfile.create({
    data: {
      userId: user.id,
      slug: `docs-${tag}-${stamp}`,
      specialtyId: specialty.id,
      licenseNumber: 'TN-E2E-1',
      bio: { fr: '', ar: '' },
      headline: { fr: `Dr ${tag}`, ar: 'د' },
      languages: ['fr'],
      isPublished: true,
    },
  });
  await prisma.clinic.create({
    data: { doctorId: profile.id, name: 'Cabinet E2E', address: { city: 'Tunis' } },
  });
  return { user, profile };
}

async function seed() {
  const a = await mkDoctor('a');
  const b = await mkDoctor('b');

  const mkPatient = async (tag: string, allergy: string | null) => {
    const user = await prisma.user.create({
      data: { email: `docs-p-${tag}-${stamp}@e2e.test`, locale: 'fr' },
    });
    const patient = await prisma.patientProfile.create({
      data: {
        userId: user.id,
        firstName: `P${tag}`,
        lastName: 'E2E',
        dateOfBirth: new Date('1990-01-01'),
        sex: Sex.UNSPECIFIED,
        phone: `+2169${String(stamp).slice(-6)}${tag === 'a' ? 1 : 2}`,
        ...(allergy ? { allergiesEnc: encryptText(allergy) } : {}),
      },
    });
    await prisma.roleAssignment.create({
      data: { userId: user.id, role: Role.PATIENT, scopeType: ScopeType.GLOBAL, grantedBy: 'e2e' },
    });
    return { user, patient };
  };

  const pa = await mkPatient('a', 'Pénicilline');
  const pb = await mkPatient('b', null);

  const linkA = await prisma.patientDoctorLink.create({
    data: { patientId: pa.patient.id, doctorId: a.profile.id, source: LinkSource.BOOKING },
  });
  const linkB = await prisma.patientDoctorLink.create({
    data: { patientId: pb.patient.id, doctorId: b.profile.id, source: LinkSource.BOOKING },
  });

  return { a, b, pa, pb, linkA, linkB };
}

async function cleanup(fx: Awaited<ReturnType<typeof seed>>) {
  const store = getObjectStore();
  for (const key of keysToClean) await store.delete(key).catch(() => {});
  await prisma.auditLog.deleteMany({
    where: { patientId: { in: [fx.pa.patient.id, fx.pb.patient.id] } },
  });
  await prisma.patientDoctorLink.deleteMany({ where: { id: { in: [fx.linkA.id, fx.linkB.id] } } });
  await prisma.clinic.deleteMany({ where: { doctorId: { in: [fx.a.profile.id, fx.b.profile.id] } } });
  await prisma.doctorProfile.deleteMany({ where: { id: { in: [fx.a.profile.id, fx.b.profile.id] } } });
  await prisma.patientProfile.deleteMany({ where: { id: { in: [fx.pa.patient.id, fx.pb.patient.id] } } });
  await prisma.user.deleteMany({
    where: { id: { in: [fx.a.user.id, fx.b.user.id, fx.pa.user.id, fx.pb.user.id] } },
  });
}

async function main() {
  console.log('\n=== Documents & prescriptions E2E ===\n');
  const fx = await seed();

  try {
    const docA = await actorFor(fx.a.user.id);
    const docB = await actorFor(fx.b.user.id);
    const patientA = await actorFor(fx.pa.user.id);

    const meds = [
      { drug: 'Amoxicilline', dose: '500 mg', frequency: '3×/jour', durationDays: 7 },
      { drug: 'Paracétamol', dose: '1 g', frequency: 'si douleur' },
    ];

    console.log('issue');
    let rejected = false;
    try {
      await issuePrescription(docA, { linkId: fx.linkA.id, medications: meds, allergyAcknowledged: false });
    } catch (e) {
      rejected = e instanceof DocumentValidationError;
    }
    check('issue rejected without allergy acknowledgment', rejected);

    const doc = await issuePrescription(docA, {
      linkId: fx.linkA.id,
      medications: meds,
      notes: 'Revoir dans une semaine.',
      allergyAcknowledged: true,
    });
    check('prescription issued', !!doc.id && doc.status === 'ACTIVE');
    check('version starts at 1', doc.version === 1);
    check('medication summary is sensible', doc.medicationSummary === 'Amoxicilline (+1)', doc.medicationSummary);

    const row = await prisma.document.findUniqueOrThrow({
      where: { id: doc.id },
      include: { prescription: true },
    });
    keysToClean.push(row.storageKey);

    // Storage round-trip + checksum.
    const stored = await getObjectStore().get(row.storageKey);
    const { createHash } = await import('node:crypto');
    const actual = createHash('sha256').update(stored.body).digest('hex');
    check('stored object exists and checksum matches', actual === row.checksum);
    check('stored bytes are a PDF', stored.body[0] === 0x25 && stored.body[1] === 0x50);
    check('byteSize recorded', row.byteSize === stored.body.length && row.byteSize > 1000);

    // Encryption at rest.
    const rawMeds = Buffer.from(row.prescription!.medicationsEnc).toString('utf8');
    check('medications stored encrypted (no plaintext drug)', !rawMeds.includes('Amoxicilline'));

    // Allergy snapshot.
    const snap = JSON.parse(decryptText(row.prescription!.allergySnapshotEnc));
    check('allergy snapshot captured what the doctor saw', snap.kind === 'listed' && snap.text === 'Pénicilline',
      JSON.stringify(snap));

    console.log('\ndownload + audit (§10)');
    const before = await prisma.auditLog.count({
      where: { action: 'document.read', resourceId: doc.id },
    });
    const dl1 = await getDocumentForDownload(patientA, doc.id);
    check('patient can download their prescription', dl1.bytes.length === row.byteSize);
    await getDocumentForDownload(docA, doc.id);
    const after = await prisma.auditLog.count({
      where: { action: 'document.read', resourceId: doc.id },
    });
    check('every read is audited', after === before + 2, `${before} → ${after}`);

    console.log('\nisolation (§2, §5)');
    let dlDenied = false;
    try {
      await getDocumentForDownload(docB, doc.id);
    } catch (e) {
      dlDenied = e instanceof ResourceNotFoundError;
    }
    check('another doctor cannot download the document (404)', dlDenied);

    const listB = await listDocuments(docB, fx.linkB.id);
    check("another doctor's own link is empty, not leaking A's", listB.length === 0);

    let listDenied = false;
    try {
      await listDocuments(docB, fx.linkA.id);
    } catch (e) {
      listDenied = e instanceof ResourceNotFoundError;
    }
    check("another doctor cannot list someone else's link", listDenied);

    console.log('\nsupersede');
    const v2 = await supersedePrescription(docA, {
      documentId: doc.id,
      medications: [{ drug: 'Amoxicilline', dose: '1 g', frequency: '2×/jour', durationDays: 5 }],
      allergyAcknowledged: true,
    });
    keysToClean.push(
      (await prisma.document.findUniqueOrThrow({ where: { id: v2.id }, select: { storageKey: true } }))
        .storageKey,
    );
    check('superseding version is 2', v2.version === 2 && v2.supersedesId === doc.id);
    const sourceAfter = await prisma.document.findUniqueOrThrow({ where: { id: doc.id } });
    check('source is now SUPERSEDED', sourceAfter.status === 'SUPERSEDED');

    let supDenied = false;
    try {
      await supersedePrescription(docA, {
        documentId: doc.id, // already superseded
        medications: meds,
        allergyAcknowledged: true,
      });
    } catch (e) {
      supDenied = e instanceof DocumentValidationError;
    }
    check('a superseded document cannot be superseded again', supDenied);

    console.log('\nrevoke');
    const revoked = await revokeDocument(docA, {
      documentId: v2.id,
      reason: 'Posologie erronée, dossier corrigé.',
    });
    check('document revoked with reason', revoked.status === 'REVOKED' && !!revoked.revokeReason);

    let revDenied = false;
    try {
      await revokeDocument(docA, { documentId: v2.id, reason: 'Encore une fois, erreur.' });
    } catch (e) {
      revDenied = e instanceof DocumentValidationError;
    }
    check('a revoked document cannot be revoked again', revDenied);
  } finally {
    await cleanup(fx);
  }

  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('E2E crashed:', e);
  await cleanupSafe();
  await prisma.$disconnect();
  process.exit(1);
});

async function cleanupSafe() {
  const store = getObjectStore();
  for (const key of keysToClean) await store.delete(key).catch(() => {});
}

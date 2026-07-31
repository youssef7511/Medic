/**
 * Consultation notes, end to end against a real Postgres.
 *
 * Covers what unit tests structurally cannot: encryption at rest, revision
 * accumulation, the retraction lifecycle, and cross-doctor isolation.
 *
 * Creates its own fixtures with unique identifiers and does not truncate — safe
 * to run alongside the UI fixtures. Still: never point it at real data.
 */
import { PrismaClient, Role, ScopeType, Sex, LinkSource } from '@prisma/client';
import {
  createNote,
  updateNote,
  retractNote,
  getJournal,
  getRevisions,
  NoteValidationError,
} from '../src/lib/clinical/notes';
import { ResourceNotFoundError, type Actor } from '../src/lib/rbac/guard';

const prisma = new PrismaClient();
let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? '✔' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (ok) passed++;
  else failed++;
}

async function actorFor(userId: string): Promise<Actor> {
  const roles = await prisma.roleAssignment.findMany({ where: { userId } });
  return { userId, roles };
}

const stamp = Date.now();

async function seed() {
  const specialty = await prisma.specialty.upsert({
    where: { slug: 'notes-e2e' },
    update: {},
    create: { slug: 'notes-e2e', name: { fr: 'Test', ar: 'اختبار' } },
  });

  const mkDoctor = async (tag: string) => {
    const user = await prisma.user.create({
      data: { email: `notes-${tag}-${stamp}@e2e.test`, locale: 'fr' },
    });
    await prisma.roleAssignment.create({
      data: { userId: user.id, role: Role.DOCTOR, scopeType: ScopeType.GLOBAL, grantedBy: 'e2e' },
    });
    const profile = await prisma.doctorProfile.create({
      data: {
        userId: user.id,
        slug: `notes-${tag}-${stamp}`,
        specialtyId: specialty.id,
        licenseNumber: 'E2E',
        bio: { fr: '', ar: '' },
        headline: { fr: 'Dr E2E', ar: 'د' },
        languages: ['fr'],
        isPublished: true,
      },
    });
    return { user, profile };
  };

  const a = await mkDoctor('a');
  const b = await mkDoctor('b');

  const patientUser = await prisma.user.create({
    data: { email: `notes-p-${stamp}@e2e.test`, locale: 'fr' },
  });
  const patient = await prisma.patientProfile.create({
    data: {
      userId: patientUser.id,
      firstName: 'E2E',
      lastName: 'Patient',
      dateOfBirth: new Date('1990-01-01'),
      sex: Sex.UNSPECIFIED,
      phone: `+2169${String(stamp).slice(-7)}`,
    },
  });

  const linkA = await prisma.patientDoctorLink.create({
    data: { patientId: patient.id, doctorId: a.profile.id, source: LinkSource.BOOKING },
  });
  const linkB = await prisma.patientDoctorLink.create({
    data: { patientId: patient.id, doctorId: b.profile.id, source: LinkSource.BOOKING },
  });

  return { a, b, patient, patientUser, linkA, linkB };
}

async function cleanup(fx: Awaited<ReturnType<typeof seed>>) {
  // Cascades remove notes, revisions and links.
  await prisma.auditLog.deleteMany({ where: { patientId: fx.patient.id } });
  await prisma.patientDoctorLink.deleteMany({
    where: { id: { in: [fx.linkA.id, fx.linkB.id] } },
  });
  await prisma.doctorProfile.deleteMany({
    where: { id: { in: [fx.a.profile.id, fx.b.profile.id] } },
  });
  await prisma.patientProfile.deleteMany({ where: { id: fx.patient.id } });
  await prisma.user.deleteMany({
    where: { id: { in: [fx.a.user.id, fx.b.user.id, fx.patientUser.id] } },
  });
}

async function main() {
  console.log('\n=== Consultation notes E2E ===\n');
  const fx = await seed();

  try {
    const doctorA = await actorFor(fx.a.user.id);
    const doctorB = await actorFor(fx.b.user.id);

    const SECRET = 'Suspected pneumonia, persistent cough three weeks.';

    console.log('create');
    const note = await createNote(doctorA, { linkId: fx.linkA.id, content: SECRET });
    check('note created', !!note.id);
    check('round-trips the text', note.content === SECRET);
    check('starts with one revision', note.revisionCount === 1, String(note.revisionCount));

    const raw = await prisma.consultationNote.findUniqueOrThrow({
      where: { id: note.id },
      select: { contentEnc: true },
    });
    check(
      'stored encrypted, not plaintext',
      !Buffer.from(raw.contentEnc).toString('utf8').includes('pneumonia'),
    );

    console.log('\nrevisions');
    const edited = await updateNote(doctorA, {
      noteId: note.id,
      content: `${SECRET} Started amoxicillin.`,
      explicit: true,
    });
    check('explicit save adds a revision', edited.revisionCount === 2, String(edited.revisionCount));

    const autosaved = await updateNote(doctorA, {
      noteId: note.id,
      content: `${SECRET} Started amoxicillin 500mg.`,
      explicit: false,
    });
    check(
      'autosave inside the window adds no revision',
      autosaved.revisionCount === 2,
      String(autosaved.revisionCount),
    );
    check('autosave still updates current text', autosaved.content.includes('500mg'));

    const stale = await updateNote(doctorA, {
      noteId: note.id,
      content: `${SECRET} Edited from a second tab.`,
      explicit: true,
      expectedUpdatedAt: new Date('2020-01-01T00:00:00Z'),
    });
    check('a stale edit is flagged as a conflict', stale.conflict === true);
    check('but the write still lands (nothing lost)', stale.content.includes('second tab'));

    const history = await getRevisions(doctorA, note.id);
    check('history is newest-first', history.length === 3 && history[0]!.reason === 'EDIT',
      `${history.length} revisions`);
    check('original wording is recoverable', history.some((r) => r.content === SECRET));

    console.log('\nisolation (§2, §5)');
    let denied = false;
    try {
      await getRevisions(doctorB, note.id);
    } catch (e) {
      denied = e instanceof ResourceNotFoundError;
    }
    check("another doctor cannot read the note's history (404)", denied);

    const journalB = await getJournal(doctorB, fx.linkB.id);
    check('another doctor sees an empty journal', journalB.length === 0);

    let deniedJournal = false;
    try {
      await getJournal(doctorB, fx.linkA.id);
    } catch (e) {
      deniedJournal = e instanceof ResourceNotFoundError;
    }
    check("another doctor cannot open someone else's link journal", deniedJournal);

    console.log('\nretraction');
    let rejected = false;
    try {
      await retractNote(doctorA, { noteId: note.id, reason: 'oops' });
    } catch (e) {
      rejected = e instanceof NoteValidationError;
    }
    check('a trivial reason is rejected', rejected);

    const retracted = await retractNote(doctorA, {
      noteId: note.id,
      reason: 'Recorded against the wrong patient record.',
    });
    check('note retracted', retracted.status === 'RETRACTED');
    check('retraction snapshots a revision', retracted.revisionCount === 4,
      String(retracted.revisionCount));

    const visible = await getJournal(doctorA, fx.linkA.id);
    check('retracted note is hidden from the journal', visible.length === 0);

    const all = await getJournal(doctorA, fx.linkA.id, { includeRetracted: true });
    check('retracted note is still retrievable', all.length === 1);
    check('retraction reason is retained', !!all[0]!.retractReason);

    let editBlocked = false;
    try {
      await updateNote(doctorA, { noteId: note.id, content: 'rewritten', explicit: true });
    } catch (e) {
      editBlocked = e instanceof NoteValidationError;
    }
    check('a retracted note cannot be edited', editBlocked);

    console.log('\naudit (§10)');
    const actions = await prisma.auditLog.findMany({
      where: { resourceId: note.id },
      select: { action: true },
    });
    const names = actions.map((a) => a.action);
    check(
      'write actions are audited',
      ['note.create', 'note.update', 'note.retract'].every((a) => names.includes(a)),
      names.join(','),
    );
  } finally {
    await cleanup(fx);
  }

  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('E2E crashed:', e);
  await prisma.$disconnect();
  process.exit(1);
});

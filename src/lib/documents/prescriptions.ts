import { DateTime } from 'luxon';
import { DocumentStatus, DocumentType, Role } from '@prisma/client';
import { prisma } from '@/lib/db';
import { audit } from '@/lib/audit';
import { createHash } from 'node:crypto';
import { encryptText, decryptText, encryptOptional } from '@/lib/crypto/envelope';
import { requireLink, requireLinkAny, requireLinkOrShare, ResourceNotFoundError, type Actor } from '@/lib/rbac/guard';
import { getObjectStore, newObjectKey } from '@/lib/storage';
import { readAllergyState, type AllergyState } from '@/lib/clinical/allergies';
import { renderPrescriptionPdf } from './render';
import {
  validateMedications,
  validateNotes,
  validateRevokeReason,
  type MedicationLine,
} from './prescriptions.validation';
import type { Locale } from '@/i18n/config';

export class DocumentValidationError extends Error {
  constructor(public code: string) {
    super(`Invalid document: ${code}`);
    this.name = 'DocumentValidationError';
  }
}

export interface DocumentView {
  id: string;
  type: DocumentType;
  status: 'ACTIVE' | 'SUPERSEDED' | 'REVOKED';
  version: number;
  issuedAt: Date;
  doctorName: string;
  patientName: string;
  medicationSummary: string;
  revokeReason: string | null;
  supersedesId: string | null;
}

function localized(json: unknown, locale: string): string {
  const rec = json as Record<string, string> | null;
  return rec?.[locale] ?? rec?.fr ?? '';
}

function summarize(meds: MedicationLine[]): string {
  if (meds.length === 0) return '';
  const first = meds[0]!.drug;
  return meds.length === 1 ? first : `${first} (+${meds.length - 1})`;
}

type DocWithRels = {
  id: string;
  type: DocumentType;
  status: DocumentStatus;
  version: number;
  issuedAt: Date;
  revokeReason: string | null;
  supersedesId: string | null;
  prescription: { medicationsEnc: Uint8Array } | null;
  link: {
    doctor: { headline: unknown };
    patient: { firstName: string; lastName: string };
  };
};

async function toView(doc: DocWithRels, locale: string): Promise<DocumentView> {
  const meds = doc.prescription
    ? (JSON.parse(await decryptText(doc.prescription.medicationsEnc)) as MedicationLine[])
    : [];
  return {
    id: doc.id,
    type: doc.type,
    status: doc.status,
    version: doc.version,
    issuedAt: doc.issuedAt,
    doctorName: localized(doc.link.doctor.headline, locale),
    patientName: `${doc.link.patient.firstName} ${doc.link.patient.lastName}`,
    medicationSummary: summarize(meds),
    revokeReason: doc.revokeReason,
    supersedesId: doc.supersedesId,
  };
}

const VIEW_INCLUDE = {
  prescription: { select: { medicationsEnc: true } },
  link: {
    select: {
      doctor: { select: { headline: true } },
      patient: { select: { firstName: true, lastName: true } },
    },
  },
} as const;

/**
 * Renders + stores a prescription, then records it atomically (§7 of the spec).
 *
 * Storage is written BEFORE the DB transaction, so a crash in between leaves an
 * orphaned (unreferenced, unreadable) object rather than a Document row pointing
 * at bytes that were never written. If the transaction throws, the object is
 * cleaned up best-effort.
 */
export async function issuePrescription(
  actor: Actor,
  args: {
    linkId: string;
    medications: MedicationLine[];
    notes?: string;
    allergyAcknowledged: boolean;
    locale?: string;
  },
): Promise<DocumentView> {
  const link = await requireLink(actor, args.linkId, 'document:issue');

  const medsError = validateMedications(args.medications);
  if (medsError) throw new DocumentValidationError(medsError);
  const notesError = validateNotes(args.notes);
  if (notesError) throw new DocumentValidationError(notesError);
  if (!args.allergyAcknowledged) throw new DocumentValidationError('allergy_not_acknowledged');

  const { key, checksum, byteSize, allergyState } = await renderAndStore(
    link.patientId,
    link.doctorId,
    args.medications,
    args.notes,
    args.locale,
  );
  const [medicationsEnc, notesEnc, allergySnapshotEnc] = await Promise.all([
    encryptText(JSON.stringify(args.medications)),
    encryptOptional(args.notes),
    encryptText(JSON.stringify(allergyState)),
  ]);

  try {
    const doc = await prisma.$transaction(async (tx) => {
      const created = await tx.document.create({
        data: {
          linkId: args.linkId,
          type: DocumentType.PRESCRIPTION,
          status: DocumentStatus.ACTIVE,
          storageKey: key,
          byteSize,
          checksum,
          version: 1,
          issuedByUserId: actor.userId,
          prescription: {
            create: {
              medicationsEnc,
              notesEnc,
              allergySnapshotEnc,
            },
          },
        },
        include: VIEW_INCLUDE,
      });

      await audit(tx, {
        actorUserId: actor.userId,
        actorRole: Role.DOCTOR,
        action: 'document.issue',
        resourceType: 'Document',
        resourceId: created.id,
        patientId: link.patientId,
        metadata: { type: 'PRESCRIPTION', version: 1 },
      });

      return created;
    });

    return toView(doc, args.locale ?? 'fr');
  } catch (e) {
    await getObjectStore()
      .delete(key)
      .catch(() => {}); // orphan cleanup is best-effort; a leaked object is harmless
    throw e;
  }
}

/** Issues a corrected version, superseding the source (§8). */
export async function supersedePrescription(
  actor: Actor,
  args: {
    documentId: string;
    medications: MedicationLine[];
    notes?: string;
    allergyAcknowledged: boolean;
    locale?: string;
  },
): Promise<DocumentView> {
  const source = await loadOwnedDocument(actor, args.documentId, 'document:issue');
  if (source.type !== DocumentType.PRESCRIPTION) throw new ResourceNotFoundError();
  if (source.status !== DocumentStatus.ACTIVE) {
    throw new DocumentValidationError('not_active');
  }

  const medsError = validateMedications(args.medications);
  if (medsError) throw new DocumentValidationError(medsError);
  const notesError = validateNotes(args.notes);
  if (notesError) throw new DocumentValidationError(notesError);
  if (!args.allergyAcknowledged) throw new DocumentValidationError('allergy_not_acknowledged');

  const { key, checksum, byteSize, allergyState } = await renderAndStore(
    source.link.patientId,
    source.link.doctorId,
    args.medications,
    args.notes,
    args.locale,
  );
  const [medicationsEnc, notesEnc, allergySnapshotEnc] = await Promise.all([
    encryptText(JSON.stringify(args.medications)),
    encryptOptional(args.notes),
    encryptText(JSON.stringify(allergyState)),
  ]);

  try {
    const doc = await prisma.$transaction(async (tx) => {
      const created = await tx.document.create({
        data: {
          linkId: source.linkId,
          type: DocumentType.PRESCRIPTION,
          status: DocumentStatus.ACTIVE,
          storageKey: key,
          byteSize,
          checksum,
          version: source.version + 1,
          supersedesId: source.id,
          issuedByUserId: actor.userId,
          prescription: {
            create: {
              medicationsEnc,
              notesEnc,
              allergySnapshotEnc,
            },
          },
        },
        include: VIEW_INCLUDE,
      });

      await tx.document.update({
        where: { id: source.id },
        data: { status: DocumentStatus.SUPERSEDED },
      });

      await audit(tx, {
        actorUserId: actor.userId,
        actorRole: Role.DOCTOR,
        action: 'document.supersede',
        resourceType: 'Document',
        resourceId: created.id,
        patientId: source.link.patientId,
        metadata: { supersedes: source.id, version: created.version },
      });

      return created;
    });

    return toView(doc, args.locale ?? 'fr');
  } catch (e) {
    await getObjectStore()
      .delete(key)
      .catch(() => {});
    throw e;
  }
}

/** Voids a document issued in error (§8). Content is untouched; only status. */
export async function revokeDocument(
  actor: Actor,
  args: { documentId: string; reason: string; locale?: string },
): Promise<DocumentView> {
  const doc = await loadOwnedDocument(actor, args.documentId, 'document:issue');
  const reasonError = validateRevokeReason(args.reason);
  if (reasonError) throw new DocumentValidationError(reasonError);
  if (doc.status !== DocumentStatus.ACTIVE) throw new DocumentValidationError('not_active');

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.document.update({
      where: { id: doc.id },
      data: {
        status: DocumentStatus.REVOKED,
        revokedAt: new Date(),
        revokedBy: actor.userId,
        revokeReason: args.reason.trim(),
      },
      include: VIEW_INCLUDE,
    });
    await audit(tx, {
      actorUserId: actor.userId,
      actorRole: Role.DOCTOR,
      action: 'document.revoke',
      resourceType: 'Document',
      resourceId: doc.id,
      patientId: doc.link.patientId,
      metadata: { reason: args.reason.trim() },
    });
    return row;
  });

  return toView(updated, args.locale ?? 'fr');
}

/**
 * The download path. Authorizes either party on the link, or a doctor holding
 * an active share (Phase 4c). Audits EVERY read (§10 — a document can leave
 * the practice, unlike a note), and verifies the stored bytes still match the
 * checksum before serving them.
 */
export async function getDocumentForDownload(
  actor: Actor,
  documentId: string,
): Promise<{ meta: DocumentView; bytes: Uint8Array; contentType: string }> {
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    include: { ...VIEW_INCLUDE, link: { select: { ...VIEW_INCLUDE.link.select, id: true, patientId: true } } },
  });
  if (!doc) throw new ResourceNotFoundError();

  // §4c: try same-link first, then fall back to share-mediated access.
  const auth = await requireLinkOrShare(actor, doc.id, ['document:read:own', 'document:read']);

  const stored = await getObjectStore().get(doc.storageKey);
  const actual = createHash('sha256').update(stored.body).digest('hex');
  if (actual !== doc.checksum) {
    throw new Error(`Checksum mismatch for document ${doc.id} — stored bytes may be corrupt.`);
  }

  await audit(prisma, {
    actorUserId: actor.userId,
    actorRole: actor.roles.map((r) => r.role).join(','),
    action: 'document.read',
    resourceType: 'Document',
    resourceId: doc.id,
    patientId: auth.patientId,
    metadata: auth.via === 'share' ? { via: 'share', shareId: auth.shareId } : undefined,
  });

  return { meta: await toView(doc, 'fr'), bytes: stored.body, contentType: doc.contentType };
}

/** The document timeline for one link. Audited once per view (like the journal). */
export async function listDocuments(
  actor: Actor,
  linkId: string,
  locale = 'fr',
): Promise<DocumentView[]> {
  const link = await requireLinkAny(actor, linkId, ['document:read:own', 'document:read']);

  const rows = await prisma.document.findMany({
    where: { linkId },
    orderBy: { issuedAt: 'desc' },
    include: VIEW_INCLUDE,
  });

  await audit(prisma, {
    actorUserId: actor.userId,
    actorRole: actor.roles.map((r) => r.role).join(','),
    action: 'document.list',
    resourceType: 'PatientDoctorLink',
    resourceId: linkId,
    patientId: link.patientId,
    metadata: { count: rows.length },
  });

  return Promise.all(rows.map((r) => toView(r, locale)));
}

// --- internals --------------------------------------------------------------

async function loadOwnedDocument(
  actor: Actor,
  documentId: string,
  permission: 'document:issue',
) {
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    include: {
      ...VIEW_INCLUDE,
      link: { select: { ...VIEW_INCLUDE.link.select, id: true, patientId: true, doctorId: true } },
    },
  });
  if (!doc) throw new ResourceNotFoundError();
  await requireLink(actor, doc.linkId, permission);
  return doc;
}

async function renderAndStore(
  patientId: string,
  doctorId: string,
  medications: MedicationLine[],
  notes: string | undefined,
  localeArg: string | undefined,
): Promise<{ key: string; checksum: string; byteSize: number; allergyState: AllergyState }> {
  const [patient, doctor] = await Promise.all([
    prisma.patientProfile.findUniqueOrThrow({
      where: { id: patientId },
      select: { firstName: true, lastName: true, dateOfBirth: true, user: { select: { locale: true } } },
    }),
    prisma.doctorProfile.findUniqueOrThrow({
      where: { id: doctorId },
      select: { headline: true, licenseNumber: true, clinics: { select: { name: true }, take: 1 } },
    }),
  ]);

  const locale = (localeArg ?? patient.user.locale ?? 'fr') as Locale;
  const allergyState = await readAllergyState(patientId);

  const rendered = await renderPrescriptionPdf({
    locale: locale === 'ar' ? 'ar' : 'fr',
    doctorName: localized(doctor.headline, locale),
    licenseNumber: doctor.licenseNumber,
    clinicName: doctor.clinics[0]?.name ?? '—',
    patientName: `${patient.firstName} ${patient.lastName}`,
    patientDob: DateTime.fromJSDate(patient.dateOfBirth, { zone: 'utc' }).toFormat('dd/MM/yyyy'),
    medications,
    notes,
    issuedAt: DateTime.now().setZone('utc').toFormat('dd/MM/yyyy'),
  });

  const key = newObjectKey('documents');
  await getObjectStore().put(key, rendered.bytes, 'application/pdf');
  return { key, checksum: rendered.checksum, byteSize: rendered.byteSize, allergyState };
}

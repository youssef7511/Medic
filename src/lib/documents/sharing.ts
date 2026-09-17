import { DocumentStatus, Role } from '@prisma/client';
import { prisma } from '@/lib/db';
import { audit } from '@/lib/audit';
import { decryptText } from '@/lib/crypto/envelope';
import { requireLink, ResourceNotFoundError, type Actor } from '@/lib/rbac/guard';
import { DocumentValidationError, type DocumentView } from './prescriptions';
import type { MedicationLine } from './prescriptions.validation';

export interface ShareView {
  id: string;
  documentId: string;
  doctorName: string;
  status: 'ACTIVE' | 'REVOKED';
  createdAt: Date;
  revokedAt: Date | null;
}

export interface SharedDocumentView extends DocumentView {
  sharedByPatientName: string;
  sharedAt: Date;
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

/**
 * Share a document with another doctor (§2, Phase 4c).
 *
 * The first deliberate hole in the link boundary: a patient explicitly shares
 * one document with a doctor who may have no other relationship with them.
 *
 * shareDocument pins the exact documentId — superseding creates a new version;
 * the patient must explicitly share it again.
 */
export async function shareDocument(
  actor: Actor,
  args: { documentId: string; targetDoctorId: string },
): Promise<ShareView> {
  // Load the document and prove the actor is the owning patient (§5).
  const doc = await prisma.document.findUnique({
    where: { id: args.documentId },
    include: {
      link: { select: { id: true, patientId: true, doctorId: true } },
    },
  });
  if (!doc) throw new ResourceNotFoundError();

  await requireLink(actor, doc.link.id, 'document:share');

  // Cannot share revoked or superseded documents.
  if (doc.status !== DocumentStatus.ACTIVE) {
    throw new DocumentValidationError('not_active');
  }

  // Target doctor must exist and be published.
  const targetDoctor = await prisma.doctorProfile.findUnique({
    where: { id: args.targetDoctorId },
    select: { id: true, isPublished: true, headline: true },
  });
  if (!targetDoctor || !targetDoctor.isPublished) {
    throw new DocumentValidationError('doctor_not_found');
  }

  // Cannot share with the doctor who issued the document (pointless).
  if (args.targetDoctorId === doc.link.doctorId) {
    throw new DocumentValidationError('cannot_share_with_issuer');
  }

  const share = await prisma.$transaction(async (tx) => {
    const created = await tx.documentShare.upsert({
      where: {
        documentId_doctorId: {
          documentId: args.documentId,
          doctorId: args.targetDoctorId,
        },
      },
      create: {
        documentId: args.documentId,
        doctorId: args.targetDoctorId,
        sharedByUserId: actor.userId,
      },
      update: {
        // Re-activating a revoked share is a new share action.
        status: 'ACTIVE',
        revokedAt: null,
      },
    });

    await audit(tx, {
      actorUserId: actor.userId,
      actorRole: Role.PATIENT,
      action: 'document.share',
      resourceType: 'Document',
      resourceId: args.documentId,
      patientId: doc.link.patientId,
      metadata: {
        targetDoctorId: args.targetDoctorId,
        documentType: doc.type,
      },
    });

    return created;
  });

  return {
    id: share.id,
    documentId: share.documentId,
    doctorName: localized(targetDoctor.headline, 'fr'),
    status: share.status,
    createdAt: share.createdAt,
    revokedAt: share.revokedAt,
  };
}

/**
 * Revoke a share. Only the owning patient can revoke.
 */
export async function revokeShare(
  actor: Actor,
  args: { shareId: string },
): Promise<ShareView> {
  const share = await prisma.documentShare.findUnique({
    where: { id: args.shareId },
    include: {
      document: {
        select: {
          link: { select: { id: true, patientId: true } },
        },
      },
      doctor: {
        select: { headline: true },
      },
    },
  });
  if (!share) throw new ResourceNotFoundError();

  // Prove the actor is the owning patient on the document's link.
  await requireLink(actor, share.document.link.id, 'document:share');

  if (share.status !== 'ACTIVE') {
    throw new DocumentValidationError('share_already_revoked');
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.documentShare.update({
      where: { id: args.shareId },
      data: {
        status: 'REVOKED',
        revokedAt: new Date(),
      },
    });

    await audit(tx, {
      actorUserId: actor.userId,
      actorRole: Role.PATIENT,
      action: 'document.share.revoke',
      resourceType: 'DocumentShare',
      resourceId: args.shareId,
      patientId: share.document.link.patientId,
      metadata: {
        targetDoctorId: share.doctorId,
        documentId: share.documentId,
      },
    });

    return row;
  });

  return {
    id: updated.id,
    documentId: updated.documentId,
    doctorName: localized(share.doctor.headline, 'fr'),
    status: updated.status,
    createdAt: updated.createdAt,
    revokedAt: updated.revokedAt,
  };
}

/**
 * List all documents shared WITH this doctor (across all patients).
 * Audited once per view.
 */
export async function listSharedDocuments(
  actor: Actor,
  locale = 'fr',
): Promise<SharedDocumentView[]> {
  // Resolve the doctor profile from the actor.
  const doctorProfile = await prisma.doctorProfile.findUnique({
    where: { userId: actor.userId },
    select: { id: true },
  });
  if (!doctorProfile) throw new ResourceNotFoundError();

  const shares = await prisma.documentShare.findMany({
    where: {
      doctorId: doctorProfile.id,
      status: 'ACTIVE',
    },
    orderBy: { createdAt: 'desc' },
    include: {
      document: {
        include: {
          prescription: { select: { medicationsEnc: true } },
          link: {
            select: {
              patient: { select: { firstName: true, lastName: true } },
            },
          },
        },
      },
    },
  });

  await audit(prisma, {
    actorUserId: actor.userId,
    actorRole: Role.DOCTOR,
    action: 'document.share_list',
    resourceType: 'DoctorProfile',
    resourceId: doctorProfile.id,
    metadata: { count: shares.length },
  });

  return shares.map((s) => {
    const doc = s.document;
    const meds = doc.prescription
      ? (JSON.parse(decryptText(doc.prescription.medicationsEnc)) as MedicationLine[])
      : [];

    return {
      id: doc.id,
      type: doc.type,
      status: doc.status,
      version: doc.version,
      issuedAt: doc.issuedAt,
      doctorName: localized(doc.link, locale),
      patientName: `${doc.link.patient.firstName} ${doc.link.patient.lastName}`,
      medicationSummary: summarize(meds),
      revokeReason: doc.revokeReason,
      supersedesId: doc.supersedesId,
      sharedByPatientName: `${doc.link.patient.firstName} ${doc.link.patient.lastName}`,
      sharedAt: s.createdAt,
    };
  });
}

/**
 * Get the share status for a set of documents (for the share indicator
 * on the patient document timeline). Returns a map of documentId → share info.
 */
export async function getDocumentShares(
  actor: Actor,
  linkId: string,
  documentIds: string[],
): Promise<Map<string, { id: string; doctorName: string; status: string }>> {
  if (documentIds.length === 0) return new Map();

  const shares = await prisma.documentShare.findMany({
    where: {
      documentId: { in: documentIds },
      status: 'ACTIVE',
    },
    include: {
      doctor: { select: { headline: true } },
    },
  });

  const map = new Map<string, { id: string; doctorName: string; status: string }>();
  for (const share of shares) {
    map.set(share.documentId, {
      id: share.id,
      doctorName: localized(share.doctor.headline, 'fr'),
      status: share.status,
    });
  }
  return map;
}

import { createHash, randomUUID } from 'node:crypto';
import { Role } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireLink, ResourceNotFoundError, type Actor } from '@/lib/rbac/guard';
import { encryptBytes, encryptText } from '@/lib/crypto/envelope';
import { getObjectStore } from '@/lib/storage';
import { audit } from '@/lib/audit';
import { validateUpload } from './uploads.validation';

/** The patient chooses one existing care relationship; no implicit cross-doctor sharing. */
export async function uploadPatientDocument(actor: Actor, args: {
  linkId: string; bytes: Uint8Array; contentType: string;
  title: string; category: string; originalName: string;
}): Promise<{ id: string; doctorId: string }> {
  const link = await requireLink(actor, args.linkId, 'document:upload:own');
  if (link.status !== 'ACTIVE') throw new ResourceNotFoundError();
  const validated = validateUpload(args.bytes, args.contentType, args);
  if (!process.env.STORAGE_ENDPOINT) throw new Error('Persistent document storage is not configured.');
  const [encrypted, metadata] = await Promise.all([
    encryptBytes(args.bytes), encryptText(JSON.stringify(validated.metadata)),
  ]);
  const key = `patient-uploads/${randomUUID()}`;
  const store = getObjectStore();
  await store.put(key, encrypted, 'application/octet-stream');
  try {
    const document = await prisma.$transaction(async tx => {
      const created = await tx.document.create({ data: {
        linkId: link.id, type: 'REPORT', contentType: validated.contentType,
        byteSize: args.bytes.length, checksum: createHash('sha256').update(encrypted).digest('hex'),
        storageKey: key, uploadMetadataEnc: metadata, issuedByUserId: actor.userId,
      }, select: { id: true } });
      await audit(tx, { actorUserId: actor.userId, actorRole: Role.PATIENT,
        action: 'document.upload', resourceType: 'Document', resourceId: created.id,
        patientId: link.patientId, metadata: { doctorId: link.doctorId, byteSize: args.bytes.length },
      });
      return created;
    });
    return { id: document.id, doctorId: link.doctorId };
  } catch (error) {
    await store.delete(key).catch(() => {});
    throw error;
  }
}

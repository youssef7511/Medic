'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getCurrentActor } from '@/lib/auth/session';
import { ResourceNotFoundError } from '@/lib/rbac/guard';
import { prisma } from '@/lib/db';
import { shareDocument, revokeShare } from '@/lib/documents/sharing';
import { DocumentValidationError } from '@/lib/documents/prescriptions';

export type ShareState = { error?: string; ok?: boolean };

const searchSchema = z.object({
  query: z.string().min(1).max(200),
  locale: z.string().default('fr'),
});

/**
 * Search published doctors by name/specialty for the share dialog.
 * Returns at most 10 results — the directory is public (§4), so this doesn't
 * need a link guard.
 */
export async function searchDoctorsAction(
  _prev: { doctors: { id: string; name: string; specialty: string }[] },
  formData: FormData,
): Promise<{ doctors: { id: string; name: string; specialty: string }[] }> {
  const parsed = searchSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { doctors: [] };

  const { query, locale } = parsed.data;

  const doctors = await prisma.doctorProfile.findMany({
    where: {
      isPublished: true,
      OR: [
        { headline: { path: [locale], string_contains: query } },
        { specialty: { name: { path: [locale], string_contains: query } } },
      ],
    },
    take: 10,
    select: {
      id: true,
      headline: true,
      specialty: { select: { name: true } },
    },
  });

  return {
    doctors: doctors.map((d) => ({
      id: d.id,
      name: (d.headline as Record<string, string>)?.[locale] ?? (d.headline as Record<string, string>)?.fr ?? '',
      specialty: (d.specialty.name as Record<string, string>)?.[locale] ?? (d.specialty.name as Record<string, string>)?.fr ?? '',
    })),
  };
}

const shareSchema = z.object({
  locale: z.string().default('fr'),
  documentId: z.string().min(1),
  targetDoctorId: z.string().min(1),
});

export async function shareDocumentAction(
  _prev: ShareState,
  formData: FormData,
): Promise<ShareState> {
  const actor = await getCurrentActor();
  if (!actor) return { error: 'Please sign in again.' };

  const parsed = shareSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Invalid input.' };
  const { documentId, targetDoctorId, locale } = parsed.data;

  try {
    await shareDocument(actor, { documentId, targetDoctorId });
    revalidatePath(`/p/doctors`);
    return { ok: true };
  } catch (e: unknown) {
    if (e instanceof ResourceNotFoundError) return { error: locale === 'ar' ? 'غير موجود.' : 'Non trouvé.' };
    if (e instanceof DocumentValidationError) {
      const messages: Record<string, { fr: string; ar: string }> = {
        not_active: { fr: 'Document révoqué ou remplacé.', ar: 'المستند ملغى أو مُستبدل.' },
        doctor_not_found: { fr: 'Médecin introuvable.', ar: 'الطبيب غير موجود.' },
        cannot_share_with_issuer: { fr: 'Vous ne pouvez pas partager avec le médecin émetteur.', ar: 'لا يمكنك المشاركة مع الطبيب المُصدر.' },
      };
      const msg = messages[e.code];
      return { error: msg ? (locale === 'ar' ? msg.ar : msg.fr) : e.message };
    }
    throw e;
  }
}

const revokeSchema = z.object({
  locale: z.string().default('fr'),
  shareId: z.string().min(1),
});

export async function revokeShareAction(
  _prev: ShareState,
  formData: FormData,
): Promise<ShareState> {
  const actor = await getCurrentActor();
  if (!actor) return { error: 'Please sign in again.' };

  const parsed = revokeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Invalid input.' };
  const { shareId, locale } = parsed.data;

  try {
    await revokeShare(actor, { shareId });
    revalidatePath(`/p/doctors`);
    return { ok: true };
  } catch (e: unknown) {
    if (e instanceof ResourceNotFoundError) return { error: locale === 'ar' ? 'غير موجود.' : 'Non trouvé.' };
    if (e instanceof DocumentValidationError) {
      return { error: locale === 'ar' ? 'المشاركة ملغاة بالفعل.' : 'Le partage est déjà révoqué.' };
    }
    throw e;
  }
}

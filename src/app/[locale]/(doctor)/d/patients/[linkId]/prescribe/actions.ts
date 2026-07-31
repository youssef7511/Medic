'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getCurrentActor } from '@/lib/auth/session';
import { ResourceNotFoundError } from '@/lib/rbac/guard';
import {
  issuePrescription,
  revokeDocument,
  DocumentValidationError,
} from '@/lib/documents/prescriptions';
import { PRESCRIPTION_ERROR_MESSAGES } from '@/lib/documents/prescriptions.validation';

export type PrescribeState = { error?: string; ok?: boolean; documentId?: string };

function message(code: string, locale: string): string {
  const entry = (PRESCRIPTION_ERROR_MESSAGES as Record<string, { fr: string; ar: string }>)[code];
  if (entry) return locale === 'ar' ? entry.ar : entry.fr;
  return locale === 'ar' ? 'تعذّر إصدار الوصفة.' : "Impossible d'émettre l'ordonnance.";
}

const medicationSchema = z.object({
  drug: z.string(),
  dose: z.string(),
  frequency: z.string().optional(),
  durationDays: z.coerce.number().int().optional(),
  instructions: z.string().optional(),
});

const issueSchema = z.object({
  locale: z.string().default('fr'),
  linkId: z.string().min(1),
  medications: z.string(), // JSON array
  notes: z.string().optional(),
  allergyAcknowledged: z.enum(['true', 'false']),
});

export async function issuePrescriptionAction(
  _prev: PrescribeState,
  formData: FormData,
): Promise<PrescribeState> {
  const actor = await getCurrentActor();
  if (!actor) return { error: 'Please sign in again.' };

  const parsed = issueSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Invalid input.' };
  const { locale, linkId, notes, allergyAcknowledged } = parsed.data;

  let medications;
  try {
    const raw = JSON.parse(parsed.data.medications) as unknown[];
    medications = z.array(medicationSchema).parse(raw);
  } catch {
    return { error: 'Invalid input.' };
  }

  try {
    const doc = await issuePrescription(actor, {
      linkId,
      medications,
      ...(notes ? { notes } : {}),
      allergyAcknowledged: allergyAcknowledged === 'true',
      locale,
    });
    revalidatePath(`/d/patients/${linkId}/documents`);
    return { ok: true, documentId: doc.id };
  } catch (e) {
    if (e instanceof ResourceNotFoundError) return { error: 'Not found.' };
    if (e instanceof DocumentValidationError) return { error: message(e.code, locale) };
    throw e;
  }
}

const revokeSchema = z.object({
  locale: z.string().default('fr'),
  linkId: z.string().min(1),
  documentId: z.string().min(1),
  reason: z.string(),
});

export async function revokeDocumentAction(
  _prev: PrescribeState,
  formData: FormData,
): Promise<PrescribeState> {
  const actor = await getCurrentActor();
  if (!actor) return { error: 'Please sign in again.' };

  const parsed = revokeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Invalid input.' };
  const { locale, linkId, documentId, reason } = parsed.data;

  try {
    await revokeDocument(actor, { documentId, reason, locale });
    revalidatePath(`/d/patients/${linkId}/documents`);
    return { ok: true };
  } catch (e) {
    if (e instanceof ResourceNotFoundError) return { error: 'Not found.' };
    if (e instanceof DocumentValidationError) return { error: message(e.code, locale) };
    throw e;
  }
}

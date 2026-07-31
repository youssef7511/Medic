import { prisma } from '@/lib/db';
import { decryptText } from '@/lib/crypto/envelope';

/**
 * Patient drug-allergy state (§3.1).
 *
 * Three states, kept distinct on purpose: an empty allergy field is ambiguous —
 * it means either "no known allergies" or "never asked", which are clinically
 * opposite. The prescribing screen must render `not_recorded` visibly, never as
 * a reassuring blank.
 */
export type AllergyState =
  | { kind: 'listed'; text: string }
  | { kind: 'none' }
  | { kind: 'not_recorded' };

/** Pure classifier — takes already-decrypted text so it needs no crypto or DB. */
export function classifyAllergy(input: {
  text: string | null;
  affirmedNone: boolean;
}): AllergyState {
  const text = input.text?.trim();
  if (text) return { kind: 'listed', text };
  if (input.affirmedNone) return { kind: 'none' };
  return { kind: 'not_recorded' };
}

/** Reads and classifies a patient's allergy state from the database. */
export async function readAllergyState(patientId: string): Promise<AllergyState> {
  const patient = await prisma.patientProfile.findUnique({
    where: { id: patientId },
    select: { allergiesEnc: true, allergiesAffirmedNone: true },
  });
  if (!patient) return { kind: 'not_recorded' };

  const text = patient.allergiesEnc ? decryptText(patient.allergiesEnc) : null;
  return classifyAllergy({ text, affirmedNone: patient.allergiesAffirmedNone });
}

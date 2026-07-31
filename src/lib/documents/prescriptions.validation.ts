/**
 * Pure validation for prescriptions. No DB, no crypto — just the rules that
 * decide whether a prescription is well-formed. Shared by the domain layer, the
 * server action, and the form so they can't disagree.
 */

export const MAX_MEDICATION_LINES = 30;
export const DRUG_MAX_CHARS = 200;
export const DOSE_MAX_CHARS = 100;
export const FREQUENCY_MAX_CHARS = 100;
export const DURATION_MAX_DAYS = 365;
export const INSTRUCTIONS_MAX_CHARS = 500;
export const NOTES_MAX_CHARS = 2000;
export const REVOKE_REASON_MIN_CHARS = 10;
export const REVOKE_REASON_MAX_CHARS = 500;

export interface MedicationLine {
  drug: string;
  dose: string;
  frequency?: string;
  durationDays?: number;
  instructions?: string;
}

export type MedsError =
  | 'empty'
  | 'too_many'
  | 'line_missing_drug'
  | 'line_missing_dose'
  | 'line_too_long'
  | 'duration_out_of_range';

export function validateMedications(lines: MedicationLine[]): MedsError | null {
  if (lines.length === 0) return 'empty';
  if (lines.length > MAX_MEDICATION_LINES) return 'too_many';

  for (const line of lines) {
    if (line.drug.trim().length === 0) return 'line_missing_drug';
    if (line.dose.trim().length === 0) return 'line_missing_dose';
    if (
      line.drug.length > DRUG_MAX_CHARS ||
      line.dose.length > DOSE_MAX_CHARS ||
      (line.frequency?.length ?? 0) > FREQUENCY_MAX_CHARS ||
      (line.instructions?.length ?? 0) > INSTRUCTIONS_MAX_CHARS
    ) {
      return 'line_too_long';
    }
    if (
      line.durationDays !== undefined &&
      (!Number.isInteger(line.durationDays) ||
        line.durationDays < 1 ||
        line.durationDays > DURATION_MAX_DAYS)
    ) {
      return 'duration_out_of_range';
    }
  }
  return null;
}

export function validateNotes(notes: string | undefined): 'notes_too_long' | null {
  return (notes?.length ?? 0) > NOTES_MAX_CHARS ? 'notes_too_long' : null;
}

export type RevokeError = 'reason_too_short' | 'reason_too_long';

export function validateRevokeReason(reason: string): RevokeError | null {
  const trimmed = reason.trim();
  if (trimmed.length < REVOKE_REASON_MIN_CHARS) return 'reason_too_short';
  if (trimmed.length > REVOKE_REASON_MAX_CHARS) return 'reason_too_long';
  return null;
}

export const PRESCRIPTION_ERROR_MESSAGES: Record<
  MedsError | 'notes_too_long' | RevokeError | 'allergy_not_acknowledged',
  { fr: string; ar: string }
> = {
  empty: { fr: 'Ajoutez au moins un médicament.', ar: 'أضف دواءً واحدًا على الأقل.' },
  too_many: {
    fr: `Maximum ${MAX_MEDICATION_LINES} lignes.`,
    ar: `الحد الأقصى ${MAX_MEDICATION_LINES} سطرًا.`,
  },
  line_missing_drug: { fr: 'Un médicament est requis sur chaque ligne.', ar: 'اسم الدواء مطلوب في كل سطر.' },
  line_missing_dose: { fr: 'Une posologie est requise sur chaque ligne.', ar: 'الجرعة مطلوبة في كل سطر.' },
  line_too_long: { fr: 'Un champ dépasse la longueur autorisée.', ar: 'أحد الحقول يتجاوز الطول المسموح.' },
  duration_out_of_range: {
    fr: `La durée doit être entre 1 et ${DURATION_MAX_DAYS} jours.`,
    ar: `يجب أن تكون المدة بين 1 و${DURATION_MAX_DAYS} يومًا.`,
  },
  notes_too_long: {
    fr: `Les notes dépassent ${NOTES_MAX_CHARS} caractères.`,
    ar: `الملاحظات تتجاوز ${NOTES_MAX_CHARS} حرفًا.`,
  },
  reason_too_short: {
    fr: `Indiquez un motif d'au moins ${REVOKE_REASON_MIN_CHARS} caractères.`,
    ar: `أدخل سببًا لا يقل عن ${REVOKE_REASON_MIN_CHARS} حرفًا.`,
  },
  reason_too_long: {
    fr: `Le motif dépasse ${REVOKE_REASON_MAX_CHARS} caractères.`,
    ar: `يتجاوز السبب ${REVOKE_REASON_MAX_CHARS} حرفًا.`,
  },
  allergy_not_acknowledged: {
    fr: 'Vous devez confirmer avoir examiné les allergies connues.',
    ar: 'يجب تأكيد مراجعة الحساسيات المعروفة.',
  },
};

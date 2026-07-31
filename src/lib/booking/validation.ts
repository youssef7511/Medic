/**
 * Validation for availability rules (§6).
 *
 * Pure and dependency-free — the rules here decide whether a doctor's schedule
 * is coherent, and getting one wrong silently corrupts every slot derived from
 * it. Worth testing without a database.
 */

export const MIN_SLOT_MINUTES = 5;
export const MAX_SLOT_MINUTES = 240;

export interface RuleDraft {
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
  startLocal: string; // "09:00"
  endLocal: string; // "13:00"
  slotMinutes: number;
}

export type RuleError =
  | 'invalid_weekday'
  | 'invalid_time'
  | 'end_before_start'
  | 'invalid_slot_length'
  | 'slot_longer_than_window'
  | 'overlaps_existing';

export function parseLocalTime(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Validates one rule, optionally against the doctor's existing rules.
 *
 * The overlap check matters more than it looks: two overlapping windows on the
 * same weekday would generate duplicate and misaligned slots (a 09:00–12:00/20min
 * rule plus a 10:00–14:00/30min rule yields two different 10:00-ish slot grids),
 * and patients would see phantom availability that collides on booking.
 */
export function validateRule(
  draft: RuleDraft,
  existing: (RuleDraft & { id?: string })[] = [],
  editingId?: string,
): RuleError[] {
  const errors: RuleError[] = [];

  if (!Number.isInteger(draft.weekday) || draft.weekday < 0 || draft.weekday > 6) {
    errors.push('invalid_weekday');
  }

  const start = parseLocalTime(draft.startLocal);
  const end = parseLocalTime(draft.endLocal);

  if (start === null || end === null) {
    errors.push('invalid_time');
    return errors; // everything downstream needs valid times
  }

  if (end <= start) errors.push('end_before_start');

  if (
    !Number.isInteger(draft.slotMinutes) ||
    draft.slotMinutes < MIN_SLOT_MINUTES ||
    draft.slotMinutes > MAX_SLOT_MINUTES
  ) {
    errors.push('invalid_slot_length');
  } else if (end > start && draft.slotMinutes > end - start) {
    // A 60-minute slot in a 30-minute window produces zero slots — the doctor
    // would publish availability that yields nothing bookable.
    errors.push('slot_longer_than_window');
  }

  if (end > start) {
    const clash = existing.some((other) => {
      if (editingId && other.id === editingId) return false;
      if (other.weekday !== draft.weekday) return false;
      const otherStart = parseLocalTime(other.startLocal);
      const otherEnd = parseLocalTime(other.endLocal);
      if (otherStart === null || otherEnd === null) return false;
      // Half-open: touching windows (12:00 end, 12:00 start) are fine.
      return start < otherEnd && otherStart < end;
    });
    if (clash) errors.push('overlaps_existing');
  }

  return errors;
}

export const RULE_ERROR_MESSAGES: Record<RuleError, { fr: string; ar: string }> = {
  invalid_weekday: { fr: 'Jour invalide.', ar: 'يوم غير صالح.' },
  invalid_time: { fr: 'Heure invalide (format HH:MM).', ar: 'وقت غير صالح (HH:MM).' },
  end_before_start: {
    fr: 'La fin doit être après le début.',
    ar: 'يجب أن تكون النهاية بعد البداية.',
  },
  invalid_slot_length: {
    fr: `Durée de créneau entre ${MIN_SLOT_MINUTES} et ${MAX_SLOT_MINUTES} minutes.`,
    ar: `مدة الموعد بين ${MIN_SLOT_MINUTES} و${MAX_SLOT_MINUTES} دقيقة.`,
  },
  slot_longer_than_window: {
    fr: 'Le créneau est plus long que la plage horaire.',
    ar: 'مدة الموعد أطول من الفترة الزمنية.',
  },
  overlaps_existing: {
    fr: 'Cette plage chevauche une plage existante.',
    ar: 'تتداخل هذه الفترة مع فترة موجودة.',
  },
};

import { AppointmentStatus } from '@prisma/client';

/**
 * §6 appointment state machine.
 *
 *   REQUESTED ──confirm──> CONFIRMED ──complete──> COMPLETED
 *       │                      │
 *       └──cancel──> CANCELLED │
 *                              ├──cancel──> CANCELLED
 *                              └──no-show──> NO_SHOW
 *
 * Encoded as data rather than scattered `if` checks so the legal transitions
 * are readable in one place and testable without a database. CANCELLED,
 * COMPLETED and NO_SHOW are terminal — an appointment never comes back.
 */
const TRANSITIONS: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  [AppointmentStatus.REQUESTED]: [AppointmentStatus.CONFIRMED, AppointmentStatus.CANCELLED],
  [AppointmentStatus.CONFIRMED]: [
    AppointmentStatus.COMPLETED,
    AppointmentStatus.CANCELLED,
    AppointmentStatus.NO_SHOW,
  ],
  [AppointmentStatus.CANCELLED]: [],
  [AppointmentStatus.COMPLETED]: [],
  [AppointmentStatus.NO_SHOW]: [],
};

export function canTransition(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export class InvalidTransitionError extends Error {
  constructor(from: AppointmentStatus, to: AppointmentStatus) {
    super(`Cannot move an appointment from ${from} to ${to}.`);
    this.name = 'InvalidTransitionError';
  }
}

export function assertTransition(from: AppointmentStatus, to: AppointmentStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

/** A slot is held (and blocks other bookings) only in these states — mirrors
 *  the WHERE clause on the exclusion constraint in 001_hardening.sql. */
export function holdsSlot(status: AppointmentStatus): boolean {
  return status === AppointmentStatus.REQUESTED || status === AppointmentStatus.CONFIRMED;
}

/** Terminal states never change again. */
export function isTerminal(status: AppointmentStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/**
 * NO_SHOW is a statement about the past. Marking a future appointment as a
 * no-show is always a mistake (usually a mis-click on the wrong row), and it
 * would feed the §13.4 gating that quietly makes a patient's future bookings
 * manual — so it's blocked rather than trusted.
 */
export function canMarkNoShow(status: AppointmentStatus, startAt: Date, now: Date): boolean {
  return canTransition(status, AppointmentStatus.NO_SHOW) && startAt.getTime() <= now.getTime();
}

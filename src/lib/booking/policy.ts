// Booking policy constants (§6, §13). Centralised so they're tunable in one
// place and visible to anyone reading the engine.

/** No booking closer than this to the appointment (§6). */
export const LEAD_TIME_MINUTES = 120;

/** No booking further out than this (§6). */
export const HORIZON_DAYS = 60;

/**
 * §13.4 — soft no-show gating. After this many no-shows with a GIVEN doctor
 * inside the window, that patient's future bookings with that doctor revert to
 * manual confirmation even when the doctor has autoConfirm on.
 *
 * Deliberately doctor-scoped: a platform-wide no-show reputation would leak
 * behaviour across practices and breach the link boundary (§2).
 */
export const NO_SHOW_THRESHOLD = 2;
export const NO_SHOW_WINDOW_DAYS = 90;

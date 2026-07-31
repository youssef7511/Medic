import { AppointmentStatus } from '@prisma/client';

// §6: reminders at T-24h and T-2h, over SMS — in this market SMS lands and
// email doesn't.
export const REMINDER_OFFSETS_MINUTES = [24 * 60, 2 * 60] as const;

export const TOPICS = {
  confirmation: 'appointment.confirmation',
  reminder: 'appointment.reminder',
  cancellation: 'appointment.cancellation',
  requestReceived: 'appointment.request_received',
  doctorNewRequest: 'appointment.doctor_new_request',
} as const;

export type Topic = (typeof TOPICS)[keyof typeof TOPICS];

export interface PlannedMessage {
  topic: Topic;
  scheduledFor: Date;
  payload: { appointmentId: string; kind?: string };
}

/**
 * Decides which notifications a freshly-booked appointment should produce.
 * Pure: `now` is injected, nothing touches the clock or the DB, so every rule
 * below is unit-testable.
 *
 * Two rules that matter:
 *  - A reminder whose moment has already passed is NOT scheduled. Booking an
 *    appointment 3 hours out must not fire a "24 hours to go" SMS immediately.
 *  - A REQUESTED (doctor-vetted, §13.2) appointment gets an acknowledgement,
 *    not a confirmation. Telling a patient their appointment is confirmed when
 *    the doctor hasn't accepted it yet is the kind of thing that makes someone
 *    show up to a closed clinic.
 */
export function planBookingMessages(args: {
  appointmentId: string;
  startAt: Date;
  status: AppointmentStatus;
  now: Date;
}): PlannedMessage[] {
  const { appointmentId, startAt, status, now } = args;
  const messages: PlannedMessage[] = [];

  if (status === AppointmentStatus.CONFIRMED) {
    messages.push({
      topic: TOPICS.confirmation,
      scheduledFor: now,
      payload: { appointmentId },
    });
    // Reminders belong ONLY to a confirmed appointment. Reminding someone about
    // a booking the doctor hasn't accepted would send them to a clinic that
    // isn't expecting them — so a REQUESTED appointment gets its reminders
    // later, at the moment the doctor confirms.
    messages.push(...planReminders({ appointmentId, startAt, now }));
  } else if (status === AppointmentStatus.REQUESTED) {
    messages.push({
      topic: TOPICS.requestReceived,
      scheduledFor: now,
      payload: { appointmentId },
    });
    // The doctor needs to know something is waiting on them, or a vetted
    // booking sits unanswered until they happen to open the calendar.
    messages.push({
      topic: TOPICS.doctorNewRequest,
      scheduledFor: now,
      payload: { appointmentId },
    });
  }

  return messages;
}

/** Reminders only — used on booking and re-used when a doctor confirms. */
export function planReminders(args: {
  appointmentId: string;
  startAt: Date;
  now: Date;
}): PlannedMessage[] {
  const { appointmentId, startAt, now } = args;

  return REMINDER_OFFSETS_MINUTES.flatMap((offset) => {
    const when = new Date(startAt.getTime() - offset * 60_000);
    // Already past — don't fire a stale reminder the instant it's created.
    if (when.getTime() <= now.getTime()) return [];
    return [
      {
        topic: TOPICS.reminder,
        scheduledFor: when,
        payload: { appointmentId, kind: `T-${offset / 60}h` },
      },
    ];
  });
}

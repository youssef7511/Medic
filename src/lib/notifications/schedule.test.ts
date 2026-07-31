import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppointmentStatus } from '@prisma/client';
import { planBookingMessages, planReminders, TOPICS } from './schedule';

const NOW = new Date('2026-07-20T09:00:00Z');
/** Comfortably beyond both reminder offsets. */
const FAR_FUTURE = new Date('2026-07-30T09:00:00Z');

function topics(messages: { topic: string }[]): string[] {
  return messages.map((m) => m.topic);
}

test('a confirmed booking gets a confirmation plus both reminders', () => {
  const messages = planBookingMessages({
    appointmentId: 'a1',
    startAt: FAR_FUTURE,
    status: AppointmentStatus.CONFIRMED,
    now: NOW,
  });

  assert.deepEqual(topics(messages), [
    TOPICS.confirmation,
    TOPICS.reminder,
    TOPICS.reminder,
  ]);
});

test('a requested booking is acknowledged, not confirmed, and gets NO reminders', () => {
  // Reminding someone about an appointment the doctor hasn't accepted would
  // send them to a clinic that isn't expecting them (§13.2).
  const messages = planBookingMessages({
    appointmentId: 'a1',
    startAt: FAR_FUTURE,
    status: AppointmentStatus.REQUESTED,
    now: NOW,
  });

  assert.deepEqual(topics(messages), [TOPICS.requestReceived, TOPICS.doctorNewRequest]);
  assert.equal(messages.some((m) => m.topic === TOPICS.reminder), false);
});

test('the doctor is notified when a booking needs vetting', () => {
  const messages = planBookingMessages({
    appointmentId: 'a1',
    startAt: FAR_FUTURE,
    status: AppointmentStatus.REQUESTED,
    now: NOW,
  });
  assert.ok(messages.some((m) => m.topic === TOPICS.doctorNewRequest));
});

test('reminders are scheduled at T-24h and T-2h', () => {
  const startAt = new Date('2026-07-25T12:00:00Z');
  const reminders = planReminders({ appointmentId: 'a1', startAt, now: NOW });

  const times = reminders.map((r) => r.scheduledFor.toISOString()).sort();
  assert.deepEqual(times, ['2026-07-24T12:00:00.000Z', '2026-07-25T10:00:00.000Z']);
});

test('a reminder whose moment already passed is not scheduled', () => {
  // Booked 3 hours out: the T-24h reminder is in the past and must be dropped,
  // or the patient gets "24 hours to go" the instant they book.
  const startAt = new Date(NOW.getTime() + 3 * 60 * 60 * 1000);
  const reminders = planReminders({ appointmentId: 'a1', startAt, now: NOW });

  assert.equal(reminders.length, 1);
  assert.equal(reminders[0]?.payload.kind, 'T-2h');
});

test('booking inside the final window produces no reminders at all', () => {
  const startAt = new Date(NOW.getTime() + 30 * 60 * 1000);
  assert.deepEqual(planReminders({ appointmentId: 'a1', startAt, now: NOW }), []);
});

test('a confirmed same-day booking still gets its confirmation', () => {
  const startAt = new Date(NOW.getTime() + 30 * 60 * 1000);
  const messages = planBookingMessages({
    appointmentId: 'a1',
    startAt,
    status: AppointmentStatus.CONFIRMED,
    now: NOW,
  });
  assert.deepEqual(topics(messages), [TOPICS.confirmation]);
});

test('terminal statuses produce no booking messages', () => {
  const messages = planBookingMessages({
    appointmentId: 'a1',
    startAt: FAR_FUTURE,
    status: AppointmentStatus.CANCELLED,
    now: NOW,
  });
  assert.deepEqual(messages, []);
});

test('every planned message carries its appointment id', () => {
  const messages = planBookingMessages({
    appointmentId: 'appt-42',
    startAt: FAR_FUTURE,
    status: AppointmentStatus.CONFIRMED,
    now: NOW,
  });
  assert.ok(messages.every((m) => m.payload.appointmentId === 'appt-42'));
});

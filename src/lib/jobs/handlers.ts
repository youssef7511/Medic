import type { PgBoss } from 'pg-boss';
import { prisma } from '@/lib/db';
import { getNotifier } from '@/lib/notifications/notifier';
import { renderSms } from '@/lib/notifications/render';
import { TOPICS, type Topic } from '@/lib/notifications/schedule';
import type { Locale } from '@/i18n/config';

interface AppointmentJob {
  appointmentId: string;
  kind?: string;
}

/**
 * Loads everything a notification needs. Note it selects NO clinical fields —
 * no reasonEnc, no notes. A reminder job has no business decrypting them, and
 * not selecting them means it can't accidentally leak them into a log or an SMS.
 */
async function loadContext(appointmentId: string) {
  return prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: {
      id: true,
      startAt: true,
      status: true,
      clinic: { select: { name: true } },
      link: {
        select: {
          doctor: {
            select: {
              headline: true,
              timezone: true,
              user: { select: { phone: true, email: true, locale: true } },
            },
          },
          patient: {
            select: {
              phone: true,
              user: { select: { locale: true } },
            },
          },
        },
      },
    },
  });
}

async function handleAppointmentNotification(topic: Topic, job: AppointmentJob): Promise<void> {
  const appointment = await loadContext(job.appointmentId);

  // The appointment vanished, or moved on since the job was queued. A reminder
  // for a cancelled appointment is worse than no reminder.
  if (!appointment) return;
  if (topic === TOPICS.reminder && appointment.status !== 'CONFIRMED') return;

  const { link, clinic } = appointment;
  const toDoctor = topic === TOPICS.doctorNewRequest;

  const recipientPhone = toDoctor ? link.doctor.user.phone : link.patient.phone;
  if (!recipientPhone) return;

  const locale = (toDoctor ? link.doctor.user.locale : link.patient.user.locale) || 'fr';
  const headline = link.doctor.headline as Record<Locale, string> | null;

  const body = renderSms(topic, {
    doctorName: headline?.[locale as Locale] ?? headline?.fr ?? 'votre médecin',
    clinicName: clinic.name,
    startAt: appointment.startAt,
    timezone: link.doctor.timezone,
    locale,
  });

  await getNotifier().sendSms({ to: recipientPhone, body });
}

/** Registers every topic handler on the worker. */
export async function registerHandlers(boss: PgBoss): Promise<void> {
  const topics: Topic[] = [
    TOPICS.confirmation,
    TOPICS.requestReceived,
    TOPICS.reminder,
    TOPICS.cancellation,
    TOPICS.doctorNewRequest,
  ];

  for (const topic of topics) {
    // Idempotent: safe to call on every worker start. Retry policy is per-queue
    // in pg-boss v12 — backoff matters because SMS providers rate-limit and a
    // tight retry loop would burn the whole allowance on one failing number.
    await boss.createQueue(topic, { retryLimit: 5, retryBackoff: true });
    await boss.work<AppointmentJob>(topic, async (jobs: { data: AppointmentJob }[]) => {
      for (const job of jobs) {
        await handleAppointmentNotification(topic, job.data);
      }
    });
  }
}

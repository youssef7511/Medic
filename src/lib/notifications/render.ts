import { DateTime } from 'luxon';
import { localeNumberingSystem, type Locale } from '@/i18n/config';
import { TOPICS, type Topic } from './schedule';

export interface AppointmentContext {
  doctorName: string;
  clinicName: string;
  startAt: Date;
  timezone: string;
  locale: string;
}

/**
 * Builds SMS bodies.
 *
 * SMS is an insecure, unauthenticated channel — it lands on a lock screen
 * anyone nearby can read, and passes through a third-party aggregator. So these
 * messages deliberately carry NO clinical information: no specialty, no reason
 * for visit, no document reference. Doctor name, time, and place is the most
 * that can be sent without disclosing why someone is seeing a physician (§10).
 *
 * Times are rendered in the CLINIC's timezone — the patient has to physically
 * be there, so the doctor's local time is the only one that means anything.
 */
export function renderSms(topic: Topic, ctx: AppointmentContext): string {
  const numbering = localeNumberingSystem[ctx.locale as Locale] ?? 'latn';
  const dt = DateTime.fromJSDate(ctx.startAt)
    .setZone(ctx.timezone)
    .setLocale(`${ctx.locale}-u-nu-${numbering}`);

  const when = dt.toLocaleString({
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

  const ar = ctx.locale === 'ar';

  switch (topic) {
    case TOPICS.confirmation:
      return ar
        ? `تم تأكيد موعدك مع ${ctx.doctorName} يوم ${when} في ${ctx.clinicName}.`
        : `Votre rendez-vous avec ${ctx.doctorName} est confirmé le ${when} à ${ctx.clinicName}.`;

    case TOPICS.requestReceived:
      return ar
        ? `تم استلام طلب موعدك مع ${ctx.doctorName} يوم ${when}. سنعلمك عند التأكيد.`
        : `Votre demande de rendez-vous avec ${ctx.doctorName} le ${when} a été reçue. Vous serez averti après confirmation.`;

    case TOPICS.reminder:
      return ar
        ? `تذكير: موعدك مع ${ctx.doctorName} يوم ${when} في ${ctx.clinicName}.`
        : `Rappel : rendez-vous avec ${ctx.doctorName} le ${when} à ${ctx.clinicName}.`;

    case TOPICS.cancellation:
      return ar
        ? `تم إلغاء موعدك مع ${ctx.doctorName} المقرر يوم ${when}.`
        : `Votre rendez-vous avec ${ctx.doctorName} du ${when} a été annulé.`;

    case TOPICS.doctorNewRequest:
      return ar
        ? `طلب موعد جديد يوم ${when} بانتظار تأكيدك.`
        : `Nouvelle demande de rendez-vous le ${when}, en attente de votre confirmation.`;

    default:
      return ar ? `تحديث بخصوص موعدك يوم ${when}.` : `Mise à jour concernant votre rendez-vous du ${when}.`;
  }
}

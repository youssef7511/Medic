/**
 * Delivery adapters (§6, §11). SMS is the primary channel in this market.
 *
 * Kept behind a narrow interface so swapping the local aggregator doesn't
 * touch any calling code, and so tests can assert on a fake.
 */

export interface SmsMessage {
  to: string;
  body: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
}

export interface Notifier {
  sendSms(message: SmsMessage): Promise<void>;
  sendEmail(message: EmailMessage): Promise<void>;
}

/**
 * Development notifier: logs instead of sending.
 *
 * Deliberately truncates the phone number and never logs the body verbatim in
 * production-like environments — a reminder body can name a clinic or a
 * specialty, and "patient X has an oncology appointment" in a log file is a
 * disclosure (§10). Logs are not a safe place for clinical context.
 */
export class ConsoleNotifier implements Notifier {
  async sendSms(message: SmsMessage): Promise<void> {
    console.info('[sms]', maskPhone(message.to), `${message.body.length} chars`);
  }

  async sendEmail(message: EmailMessage): Promise<void> {
    console.info('[email]', maskEmail(message.to), message.subject);
  }
}

function maskPhone(phone: string): string {
  return phone.length <= 4 ? '***' : `***${phone.slice(-3)}`;
}

function maskEmail(email: string): string {
  const [, domain] = email.split('@');
  return `***@${domain ?? '***'}`;
}

/**
 * TODO(provider): implement against the chosen local SMS aggregator and an
 * EU/local-region email provider, then select via env. Until then every
 * environment gets the console adapter, which is safe but sends nothing —
 * so reminders are NOT actually delivered yet.
 */
export function getNotifier(): Notifier {
  return new ConsoleNotifier();
}

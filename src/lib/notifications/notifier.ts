/**
 * Delivery adapters (§6, §11). SMS is the primary channel in this market.
 *
 * Production supports both Twilio and a local aggregator exposing a JSON HTTP
 * endpoint. The narrow interface keeps provider choice outside clinical and
 * booking code. No adapter logs message bodies or full phone numbers.
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

type Fetcher = typeof fetch;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the configured SMS provider.`);
  return value;
}

function assertMessage(message: SmsMessage): void {
  // Providers and the DB should both use normalized E.164. Rejecting here is
  // safer than silently delivering to a provider-guessed country code.
  if (!/^\+[1-9]\d{7,14}$/.test(message.to)) {
    throw new Error('SMS destination must be an E.164 phone number.');
  }
  if (!message.body.trim()) throw new Error('SMS body cannot be empty.');
  if (message.body.length > 480) throw new Error('SMS body exceeds the 480-character limit.');
}

async function checkedFetch(fetcher: Fetcher, url: string, init: RequestInit): Promise<void> {
  const response = await fetcher(url, {
    ...init,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    // Never include provider response bodies: some echo the destination and
    // message, which would copy patient metadata into application logs.
    throw new Error(`SMS provider rejected the request (HTTP ${response.status}).`);
  }
}

export class ConsoleNotifier implements Notifier {
  async sendSms(message: SmsMessage): Promise<void> {
    assertMessage(message);
    console.info('[sms]', maskPhone(message.to), `${message.body.length} chars`);
  }

  async sendEmail(message: EmailMessage): Promise<void> {
    console.info('[email]', maskEmail(message.to), message.subject);
  }
}

export class TwilioNotifier implements Notifier {
  constructor(
    private readonly accountSid = required('TWILIO_ACCOUNT_SID'),
    private readonly authToken = required('TWILIO_AUTH_TOKEN'),
    private readonly from = required('TWILIO_FROM_NUMBER'),
    private readonly fetcher: Fetcher = fetch,
  ) {}

  async sendSms(message: SmsMessage): Promise<void> {
    assertMessage(message);
    const form = new URLSearchParams({ To: message.to, From: this.from, Body: message.body });
    await checkedFetch(
      this.fetcher,
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.accountSid)}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form,
      },
    );
  }

  async sendEmail(message: EmailMessage): Promise<void> {
    // Email is not wired in this phase; retaining a redacted console fallback
    // is explicit and does not affect the real SMS delivery path.
    console.info('[email]', maskEmail(message.to), message.subject);
  }
}

/** Adapter for a local/regional aggregator accepting a JSON POST. */
export class HttpSmsNotifier implements Notifier {
  constructor(
    private readonly endpoint = required('SMS_HTTP_ENDPOINT'),
    private readonly apiKey = required('SMS_PROVIDER_API_KEY'),
    private readonly sender = required('SMS_SENDER'),
    private readonly fetcher: Fetcher = fetch,
  ) {}

  async sendSms(message: SmsMessage): Promise<void> {
    assertMessage(message);
    await checkedFetch(this.fetcher, this.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to: message.to, from: this.sender, message: message.body }),
    });
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

let cachedNotifier: Notifier | undefined;

export function getNotifier(): Notifier {
  if (cachedNotifier) return cachedNotifier;

  const provider = process.env.SMS_PROVIDER?.trim().toLowerCase() ?? 'console';
  if (provider === 'twilio') cachedNotifier = new TwilioNotifier();
  else if (provider === 'http') cachedNotifier = new HttpSmsNotifier();
  else if (provider === 'console' && process.env.NODE_ENV !== 'production') {
    cachedNotifier = new ConsoleNotifier();
  } else if (provider === 'console') {
    throw new Error('SMS_PROVIDER=console is forbidden in production.');
  } else {
    throw new Error(`Unsupported SMS_PROVIDER: ${provider}.`);
  }

  return cachedNotifier;
}

export function setNotifierForTests(notifier?: Notifier): void {
  cachedNotifier = notifier;
}

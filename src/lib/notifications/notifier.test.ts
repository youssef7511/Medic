import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpSmsNotifier, TwilioNotifier } from './notifier';

function response(status = 201): Response {
  return new Response(null, { status });
}

test('Twilio adapter sends a form-authenticated SMS', async () => {
  let captured: { url: string; init?: RequestInit } | undefined;
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    captured = { url: String(url), init };
    return response();
  }) as typeof fetch;

  const notifier = new TwilioNotifier('AC123', 'secret', '+21670000000', fakeFetch);
  await notifier.sendSms({ to: '+21699111222', body: 'Rappel de rendez-vous' });

  assert.match(captured!.url, /Accounts\/AC123\/Messages\.json$/);
  assert.equal(captured!.init?.method, 'POST');
  assert.match(String(captured!.init?.body), /To=%2B21699111222/);
  assert.match(String(captured!.init?.body), /Body=Rappel/);
  assert.match(
    String((captured!.init?.headers as Record<string, string>).Authorization),
    /^Basic /,
  );
});

test('generic HTTP adapter sends the regional aggregator contract', async () => {
  let captured: RequestInit | undefined;
  const fakeFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    captured = init;
    return response(200);
  }) as typeof fetch;

  const notifier = new HttpSmsNotifier('https://sms.example.test/send', 'key', 'Medic', fakeFetch);
  await notifier.sendSms({ to: '+21699111222', body: 'Votre rendez-vous est confirmé.' });

  assert.deepEqual(JSON.parse(String(captured!.body)), {
    to: '+21699111222',
    from: 'Medic',
    message: 'Votre rendez-vous est confirmé.',
  });
  assert.equal(
    (captured!.headers as Record<string, string>).Authorization,
    'Bearer key',
  );
});

test('provider failures are surfaced without echoing sensitive response text', async () => {
  const fakeFetch = (async () => new Response('phone + message echoed here', { status: 429 })) as typeof fetch;
  const notifier = new HttpSmsNotifier('https://sms.example.test/send', 'key', 'Medic', fakeFetch);

  await assert.rejects(
    () => notifier.sendSms({ to: '+21699111222', body: 'Private reminder' }),
    (error: Error) => error.message === 'SMS provider rejected the request (HTTP 429).',
  );
});

test('invalid non-E.164 destinations are rejected before delivery', async () => {
  const notifier = new TwilioNotifier('AC123', 'secret', '+21670000000', fetch);
  await assert.rejects(() => notifier.sendSms({ to: '99 111 222', body: 'Reminder' }));
});

/**
 * Background worker. Run alongside the app:  npm run worker
 *
 * Two responsibilities:
 *   1. drain the transactional outbox onto pg-boss (dispatcher)
 *   2. execute the resulting notification jobs (handlers)
 *
 * Deliberately a separate process from the web app: a long-running queue
 * consumer inside a serverless request path doesn't work, and keeping it out
 * means the app stays host-agnostic (§10).
 */
import { getBoss, stopBoss } from '@/lib/jobs/queue';
import { registerHandlers } from '@/lib/jobs/handlers';
import { dispatchOutbox } from '@/lib/jobs/dispatcher';

const DISPATCH_INTERVAL_MS = 15_000;

async function main() {
  const boss = await getBoss();
  await registerHandlers(boss);
  console.info('[worker] handlers registered');

  let stopping = false;

  const tick = async () => {
    if (stopping) return;
    try {
      const n = await dispatchOutbox();
      if (n > 0) console.info(`[worker] dispatched ${n} outbox message(s)`);
    } catch (err) {
      // Never let a bad tick kill the loop — the next one may well succeed.
      console.error('[worker] dispatch failed', err);
    }
  };

  await tick();
  const timer = setInterval(tick, DISPATCH_INTERVAL_MS);

  const shutdown = async (signal: string) => {
    console.info(`[worker] ${signal} received, shutting down`);
    stopping = true;
    clearInterval(timer);
    await stopBoss();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[worker] fatal', err);
  process.exit(1);
});

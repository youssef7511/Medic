import { PgBoss } from 'pg-boss';

/**
 * pg-boss lives in the SAME Postgres database (§11) — no Redis to run, and
 * one thing to back up and keep in-jurisdiction (§10).
 *
 * Note this module is imported only by the worker process, never by a request
 * path: booking writes to the outbox table instead. Keeping the queue out of
 * the request path is what makes the transactional guarantee possible.
 */
let boss: PgBoss | null = null;

export async function getBoss(): Promise<PgBoss> {
  if (boss) return boss;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required to start the job queue.');

  boss = new PgBoss({
    connectionString,
    // Keep queue tables out of `public` so they never collide with Prisma's
    // migrations or show up in a schema diff.
    schema: 'pgboss',
  });

  boss.on('error', (err: unknown) => console.error('[pg-boss]', err));
  await boss.start();
  return boss;
}

export async function stopBoss(): Promise<void> {
  if (!boss) return;
  await boss.stop({ graceful: true });
  boss = null;
}

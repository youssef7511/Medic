/**
 * One-time rolling migration from legacy v1 env-key envelopes to v2 KMS.
 *
 * Safety:
 * - updates one row at a time with a version predicate (restartable/idempotent)
 * - never prints plaintext or identifiers
 * - keeps v1 read support until operators verify the migration and remove the
 *   legacy ENCRYPTION_MASTER_KEY in a later deploy
 */
import { prisma } from '../src/lib/db';
import { decryptText, encryptText } from '../src/lib/crypto/envelope';
import { getKeyProvider } from '../src/lib/crypto/key-provider';

const targets = [
  ['PatientProfile', 'allergiesEnc'],
  ['Appointment', 'reasonEnc'],
  ['ConsultationNote', 'contentEnc'],
  ['ConsultationNoteRevision', 'contentEnc'],
  ['Prescription', 'medicationsEnc'],
  ['Prescription', 'notesEnc'],
  ['Prescription', 'allergySnapshotEnc'],
  ['Message', 'bodyEnc'],
] as const;

interface LegacyRow {
  id: string;
  value: Uint8Array;
}

async function migrateColumn(table: string, column: string): Promise<number> {
  let migrated = 0;
  for (;;) {
    // Identifiers are selected exclusively from the hard-coded list above.
    const rows = await prisma.$queryRawUnsafe<LegacyRow[]>(
      `SELECT id, "${column}" AS value FROM "${table}" ` +
        `WHERE "${column}" IS NOT NULL AND get_byte("${column}", 0) = 1 LIMIT 50`,
    );
    if (rows.length === 0) return migrated;

    for (const row of rows) {
      const plaintext = await decryptText(row.value);
      const rewrapped = await encryptText(plaintext);
      const changed = await prisma.$executeRawUnsafe(
        `UPDATE "${table}" SET "${column}" = $1 ` +
          `WHERE id = $2 AND get_byte("${column}", 0) = 1`,
        Buffer.from(rewrapped),
        row.id,
      );
      migrated += changed;
    }
  }
}

async function main() {
  if (process.env.CONFIRM_KMS_REWRAP !== 'phase7') {
    throw new Error('Set CONFIRM_KMS_REWRAP=phase7 to run this production data migration.');
  }
  if (getKeyProvider().name !== 'aws-kms') {
    throw new Error('KMS_PROVIDER=aws is required; refusing to rewrap into a local key.');
  }
  if (!process.env.ENCRYPTION_MASTER_KEY) {
    throw new Error('The legacy ENCRYPTION_MASTER_KEY is required until all v1 rows are rewrapped.');
  }

  for (const [table, column] of targets) {
    const count = await migrateColumn(table, column);
    console.info(`[rewrap] ${table}.${column}: ${count} row(s)`);
  }
}

main()
  .catch((error) => {
    console.error('[rewrap] failed', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());

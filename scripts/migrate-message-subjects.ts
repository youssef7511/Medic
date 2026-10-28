/** Preserve old subjects encrypted while removing the duplicated plaintext copy. Restartable. */
import { prisma } from '../src/lib/db';
import { encryptText } from '../src/lib/crypto/envelope';
async function main() {
  let total = 0;
  for (;;) {
    const rows = await prisma.messageThread.findMany({ where: { subject: { not: null } }, select: { id: true, subject: true }, take: 50 });
    if (!rows.length) break;
    for (const row of rows) {
      const encrypted = await encryptText(row.subject!);
      const result = await prisma.messageThread.updateMany({ where: { id: row.id, subject: row.subject }, data: { subjectEnc: encrypted, subject: null } });
      total += result.count;
    }
  }
  console.log(`Protected ${total} historical conversation subjects. Message history was not changed.`);
}
main().catch(() => { console.error('Subject protection failed; existing data was preserved.'); process.exitCode = 1; }).finally(() => prisma.$disconnect());

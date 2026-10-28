/**
 * Seed data for local development ONLY. All fake. Never run against a real DB.
 *
 * §10 reminder: the moment one genuine patient row exists, the hosting
 * jurisdiction is decided. Keep this file seeding fictional data exclusively.
 */
import { PrismaClient } from '@prisma/client';
import { STANDARD_SPECIALTIES as SPECIALTIES } from '../src/lib/doctors/specialties';

const prisma = new PrismaClient();

async function main() {
  for (const s of SPECIALTIES) {
    await prisma.specialty.upsert({
      where: { slug: s.slug },
      update: { name: s.name },
      create: s,
    });
  }
  console.log(`Seeded ${SPECIALTIES.length} specialties.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

import { prisma } from '@/lib/db';
import { STANDARD_SPECIALTIES } from './specialties';

/** Only public profile fields cross into the marketing pages. */
export async function getPublicDirectory() {
  try {
    const doctors = await prisma.doctorProfile.findMany({
      where: { isPublished: true },
      select: {
        id: true, slug: true, headline: true, bio: true, photoUrl: true, languages: true,
        specialty: { select: { slug: true, name: true } },
        clinics: { select: { name: true, address: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 60,
    });
    const specialties = [...new Map<string, { slug: string; name: unknown }>([
      ...STANDARD_SPECIALTIES.map(item => [item.slug, item] as const),
      ...doctors.map(doctor => [doctor.specialty.slug, doctor.specialty] as const),
    ]).values()];
    return { doctors, specialties };
  } catch { return { doctors: [], specialties: STANDARD_SPECIALTIES }; }
}

export type PublicDoctor = Awaited<ReturnType<typeof getPublicDirectory>>['doctors'][number];

export function publicText(value: unknown, locale: string) {
  const text = value as Record<string, unknown> | null;
  const translated = text?.[locale] ?? text?.fr;
  return typeof translated === 'string' ? translated : '';
}

export function publicClinicCity(address: unknown) {
  const fields = address as Record<string, unknown> | null;
  return typeof fields?.city === 'string' ? fields.city : '';
}

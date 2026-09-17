import { getTranslations } from 'next-intl/server';
import { Role } from '@prisma/client';
import { requireRole } from '@/lib/auth/guards';
import { SpaceShell } from '@/components/SpaceShell';

export const dynamic = 'force-dynamic';

export default async function DoctorLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  // Both roles enter the space; note-level access is gated per-resource by the
  // guard, where DOCTOR_STAFF is blocked from clinical content (§5).
  await requireRole(locale, [Role.DOCTOR, Role.DOCTOR_STAFF], `/${locale}/d`);
  const t = await getTranslations();
  const ar = locale === 'ar';

  const nav = [
    { href: '/d', label: ar ? 'المواعيد' : 'Rendez-vous' },
    { href: '/d/calendar', label: ar ? 'التقويم' : 'Agenda' },
    { href: '/d/availability', label: ar ? 'ساعات العمل' : 'Disponibilités' },
    { href: '/d/threads', label: ar ? 'المحادثات' : 'Conversations' },
    { href: '/d/shared-documents', label: ar ? 'مستندات مشتركة' : 'Documents partagés' },
  ];

  return (
    <SpaceShell title={t('spaces.doctor')} home="/d" nav={nav}>
      {children}
    </SpaceShell>
  );
}

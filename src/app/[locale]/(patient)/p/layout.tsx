import { getTranslations } from 'next-intl/server';
import { Role } from '@prisma/client';
import { requireRole } from '@/lib/auth/guards';
import { SpaceShell } from '@/components/SpaceShell';

export const dynamic = 'force-dynamic';

export default async function PatientLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  await requireRole(locale, [Role.PATIENT], `/${locale}/p`);
  const t = await getTranslations();

  const nav = [
    { href: '/p', label: t('nav.myDoctors') },
    { href: '/p/appointments', label: t('nav.myAppointments') },
    { href: '/p/allergies', label: locale === 'ar' ? 'الحساسيات' : 'Allergies' },
  ];

  return (
    <SpaceShell title={t('spaces.patient')} home="/p" nav={nav}>
      {children}
    </SpaceShell>
  );
}

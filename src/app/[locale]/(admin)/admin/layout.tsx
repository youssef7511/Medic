import { getTranslations } from 'next-intl/server';
import { Role } from '@prisma/client';
import { requireRole } from '@/lib/auth/guards';
import { SpaceShell } from '@/components/SpaceShell';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  await requireRole(locale, [Role.SUPER_ADMIN, Role.SUPPORT_ADMIN], `/${locale}/admin`);
  const t = await getTranslations();

  return (
    <SpaceShell title={t('spaces.admin')} home="/admin">
      {children}
    </SpaceShell>
  );
}

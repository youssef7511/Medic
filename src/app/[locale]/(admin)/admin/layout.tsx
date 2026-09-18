import { getTranslations } from 'next-intl/server';
import { Role } from '@prisma/client';
import { requireRole } from '@/lib/auth/guards';
import { SpaceShell } from '@/components/SpaceShell';
import { hasPermission } from '@/lib/rbac/guard';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const actor = await requireRole(locale, [Role.SUPER_ADMIN, Role.SUPPORT_ADMIN], `/${locale}/admin`);
  const t = await getTranslations();
  const ar = locale === 'ar';

  const nav = [
    { href: '/admin', label: ar ? 'لوحة التحكم' : 'Tableau de bord' },
    { href: '/admin/doctors', label: ar ? 'أطباء' : 'Médecins' },
    { href: '/admin/users', label: ar ? 'المستخدمون' : 'Utilisateurs' },
    { href: '/admin/audit', label: ar ? 'سجل التدقيق' : 'Journal d\'audit' },
    ...(hasPermission(actor, 'break_glass:activate')
      ? [{ href: '/admin/break-glass', label: 'Break-glass' }]
      : []),
  ];

  return (
    <SpaceShell title={t('spaces.admin')} home="/admin" nav={nav}>
      {children}
    </SpaceShell>
  );
}

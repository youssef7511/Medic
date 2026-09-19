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
    { href: '/admin', label: ar ? 'لوحة التحكم' : 'Tableau de bord', icon: 'dashboard' as const },
    { href: '/admin/doctors', label: ar ? 'أطباء' : 'Médecins', icon: 'doctors' as const },
    { href: '/admin/users', label: ar ? 'المستخدمون' : 'Utilisateurs', icon: 'users' as const },
    { href: '/admin/audit', label: ar ? 'سجل التدقيق' : 'Journal d\'audit', icon: 'audit' as const },
    ...(hasPermission(actor, 'platform_settings:read')
      ? [{ href: '/admin/settings', label: ar ? 'إعدادات المنصة' : 'Paramètres', icon: 'settings' as const }]
      : []),
    ...(hasPermission(actor, 'break_glass:activate')
      ? [{ href: '/admin/break-glass', label: 'Break-glass', icon: 'emergency' as const, danger: true }]
      : []),
  ];

  return (
    <SpaceShell title={t('spaces.admin')} home="/admin" nav={nav}>
      {children}
    </SpaceShell>
  );
}

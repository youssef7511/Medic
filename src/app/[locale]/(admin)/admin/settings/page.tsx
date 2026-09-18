import { notFound, redirect } from 'next/navigation';
import { getCurrentActor } from '@/lib/auth/session';
import { getPlatformSettings } from '@/lib/admin/platform-settings-service';
import { hasPermission } from '@/lib/rbac/guard';
import { PlatformSettingsForm } from './PlatformSettingsForm';

export const dynamic = 'force-dynamic';

export default async function PlatformSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const ar = locale === 'ar';
  const actor = await getCurrentActor();
  if (!actor) redirect(`/${locale}/login`);
  if (!hasPermission(actor, 'platform_settings:read')) notFound();

  const settings = await getPlatformSettings();
  const canWrite = hasPermission(actor, 'platform_settings:write');

  return (
    <section className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">
          {ar ? 'إعدادات المنصة' : 'Paramètres de la plateforme'}
        </h1>
        <p className="mt-2 text-sm text-gray-500">
          {ar
            ? 'إعدادات تشغيلية عامة. لا يمكن تخفيض ضوابط الأمان من هذه الصفحة.'
            : 'Configuration opérationnelle globale. Les contrôles de sécurité ne peuvent pas être affaiblis ici.'}
        </p>
      </div>

      <PlatformSettingsForm locale={locale} canWrite={canWrite} settings={settings} />

      {settings.updatedAt && (
        <p className="text-xs text-gray-400">
          {ar ? 'آخر تحديث:' : 'Dernière modification :'}{' '}
          {settings.updatedAt.toLocaleString(locale)}
        </p>
      )}
    </section>
  );
}

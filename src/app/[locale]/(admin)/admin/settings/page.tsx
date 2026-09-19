import { notFound, redirect } from 'next/navigation';
import { getCurrentActor } from '@/lib/auth/session';
import { getPlatformSettings } from '@/lib/admin/platform-settings-service';
import { hasPermission } from '@/lib/rbac/guard';
import { PlatformSettingsForm } from './PlatformSettingsForm';
import { LockKeyhole, Settings } from 'lucide-react';

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
    <section className="max-w-3xl space-y-6">
      <div>
        <p className="medic-kicker">{ar ? 'التكوين التشغيلي' : 'Configuration opérationnelle'}</p>
        <h1 className="medic-page-title mt-2">{ar ? 'إعدادات المنصة' : 'Paramètres de la plateforme'}</h1>
        <p className="mt-2 text-sm text-slate-500">
          {ar
            ? 'إعدادات تشغيلية عامة. لا يمكن تخفيض ضوابط الأمان من هذه الصفحة.'
            : 'Configuration opérationnelle globale. Les contrôles de sécurité ne peuvent pas être affaiblis ici.'}
        </p>
      </div>

      <PlatformSettingsForm locale={locale} canWrite={canWrite} settings={settings} />

      <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-slate-600 shadow-sm"><LockKeyhole className="h-5 w-5" /></span><div><p className="text-sm font-semibold text-navy-950">{ar ? 'ضوابط الأمان ثابتة' : 'Contrôles de sécurité protégés'}</p><p className="mt-1 text-xs leading-5 text-slate-500">{ar ? 'لا يمكن تعطيل MFA أو التدقيق أو التشفير من هذه الصفحة.' : 'Le MFA, l’audit et le chiffrement ne peuvent pas être désactivés depuis cette page.'}</p></div></div>

      {settings.updatedAt && (
        <p className="flex items-center gap-2 text-xs text-slate-400"><Settings className="h-3.5 w-3.5" />
          {ar ? 'آخر تحديث:' : 'Dernière modification :'}{' '}
          {settings.updatedAt.toLocaleString(locale)}
        </p>
      )}
    </section>
  );
}

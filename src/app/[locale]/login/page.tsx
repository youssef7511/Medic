import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getCurrentActor } from '@/lib/auth/session';
import { defaultLandingFor, safeNextPath } from '@/lib/auth/redirects';
import { LoginForm } from './LoginForm';
import { getPlatformSettings } from '@/lib/admin/platform-settings-service';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const { locale } = await params;
  const { next } = await searchParams;
  const t = await getTranslations();

  // Already signed in → straight to the (validated) destination, defaulting to
  // whichever space this actor's roles actually grant.
  const actor = await getCurrentActor();
  if (actor) redirect(safeNextPath(next, locale, defaultLandingFor(actor.roles, locale)));

  const settings = await getPlatformSettings();

  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <h1 className="text-2xl font-bold">{t('common.login')}</h1>
      <div className="mt-8">
        <LoginForm next={next} />
      </div>
      {(settings.supportEmail || settings.supportPhone) && (
        <div className="mt-6 rounded border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
          <p className="font-medium">{locale === 'ar' ? 'الدعم' : 'Support'}</p>
          {settings.supportEmail && <p>{settings.supportEmail}</p>}
          {settings.supportPhone && <p>{settings.supportPhone}</p>}
        </div>
      )}
    </div>
  );
}

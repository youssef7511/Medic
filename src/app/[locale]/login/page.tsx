import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getCurrentActor } from '@/lib/auth/session';
import { defaultLandingFor, safeNextPath } from '@/lib/auth/redirects';
import { LoginForm } from './LoginForm';

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

  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <h1 className="text-2xl font-bold">{t('common.login')}</h1>
      <div className="mt-8">
        <LoginForm next={next} />
      </div>
    </div>
  );
}

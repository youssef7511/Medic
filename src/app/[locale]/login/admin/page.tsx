import { LoginPortalShell } from '../LoginPortalShell';

export const dynamic = 'force-dynamic';

export default async function AdminLoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const { locale } = await params;
  const { next } = await searchParams;
  return <LoginPortalShell locale={locale} next={next} portal="admin" />;
}

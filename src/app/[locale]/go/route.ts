import { NextResponse } from 'next/server';
import { getCurrentActor } from '@/lib/auth/session';
import { defaultLandingFor } from '@/lib/auth/redirects';
import { isLocale, defaultLocale } from '@/i18n/config';

export const dynamic = 'force-dynamic';

/**
 * "Take me to my space." Resolves the right destination server-side from the
 * caller's roles.
 *
 * This exists so the public header can offer a single static link without
 * knowing anything about the visitor. Putting roles in the JWT would make the
 * link render client-side, but then it goes stale the moment an admin changes
 * someone's role — here the answer is computed fresh, from the database, on
 * every click.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ locale: string }> },
) {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : defaultLocale;

  const actor = await getCurrentActor();
  const target = actor ? defaultLandingFor(actor.roles, locale) : `/${locale}/login`;

  // Base off the incoming request rather than an env var, so this works
  // unchanged on localhost, a preview URL, and production.
  return NextResponse.redirect(new URL(target, request.url));
}

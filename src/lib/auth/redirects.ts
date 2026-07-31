import { Role } from '@prisma/client';
import { locales } from '@/i18n/config';

// Post-login destinations we're willing to honour (§4).
const ALLOWED_PREFIXES = ['/p', '/d', '/admin'];

/**
 * Where a signed-in user belongs when no explicit `next` was given.
 *
 * Falling back to /p for everyone sent doctors into the patient space, where
 * the role gate promptly bounced them to the landing page — so a doctor could
 * sign in successfully and still end up nowhere. Highest privilege wins, since
 * one person can hold several roles.
 */
export function defaultLandingFor(roles: { role: Role }[], locale: string): string {
  const held = new Set(roles.map((r) => r.role));
  if (held.has(Role.SUPER_ADMIN) || held.has(Role.SUPPORT_ADMIN)) return `/${locale}/admin`;
  if (held.has(Role.DOCTOR) || held.has(Role.DOCTOR_STAFF)) return `/${locale}/d`;
  return `/${locale}/p`;
}

/**
 * Validates the `next` query param against an allowlist of internal paths.
 *
 * An unvalidated `next` is a textbook open redirect: a link to
 * `/login?next=https://evil.example/login` sends the patient to a pixel-perfect
 * fake login after a real one. Rejecting anything that isn't a known internal
 * path costs nothing and closes it.
 *
 * Rejects: absolute URLs, protocol-relative `//evil.com`, backslash tricks,
 * and any path outside the three authenticated spaces.
 */
export function safeNextPath(
  next: string | undefined,
  locale: string,
  fallbackPath?: string,
): string {
  const fallback = fallbackPath ?? `/${locale}/p`;
  if (!next) return fallback;

  // Must be a plain, single-leading-slash path. No scheme, no host, no `\`.
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\')) {
    return fallback;
  }
  if (next.includes('://')) return fallback;

  // Strip an optional leading locale segment before matching the allowlist.
  const segments = next.split('/').filter(Boolean);
  const first = segments[0];
  const hasLocale = first !== undefined && (locales as readonly string[]).includes(first);
  const pathWithoutLocale = '/' + (hasLocale ? segments.slice(1) : segments).join('/');

  const allowed = ALLOWED_PREFIXES.some(
    (p) => pathWithoutLocale === p || pathWithoutLocale.startsWith(`${p}/`),
  );
  if (!allowed) return fallback;

  return hasLocale ? next : `/${locale}${next}`;
}

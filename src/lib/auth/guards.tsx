import { redirect } from 'next/navigation';
import { Role } from '@prisma/client';
import { getCurrentActor } from './session';
import type { Actor } from '@/lib/rbac/guard';

/**
 * Space-level gate used by the (patient)/(doctor)/(admin) layouts.
 * Redirects to the localized login (preserving `next`) if the actor isn't
 * signed in or lacks any of the allowed roles. This is coarse space-entry
 * only — per-resource authorization is still the guard's requireLink (§5).
 */
export async function requireRole(
  locale: string,
  allowed: Role[],
  currentPath: string,
): Promise<Actor> {
  const actor = await getCurrentActor();

  if (!actor) {
    redirect(`/${locale}/login?next=${encodeURIComponent(currentPath)}`);
  }

  const now = Date.now();
  const has = actor.roles.some(
    (r) => allowed.includes(r.role) && (!r.expiresAt || r.expiresAt.getTime() > now),
  );

  if (!has) {
    // Signed in but wrong space → home, not login. Don't confirm the space exists.
    redirect(`/${locale}`);
  }

  return actor;
}

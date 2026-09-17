'use server';

import { auth, signOut } from '@/auth';
import { revokeSession } from '@/lib/auth/session';
import { auditNow } from '@/lib/audit';

/**
 * Signs out and *revokes the session row* (§10).
 *
 * Clearing the cookie alone would leave the session valid server-side until it
 * expired — anyone replaying the token would still be let in. Revoking first
 * means getCurrentActor rejects it on the very next request, which is the whole
 * point of keeping sessions in the database.
 *
 * Order matters: revoke before signOut, because signOut clears the cookie we
 * need in order to know which session to revoke.
 */
export async function signOutAction() {
  const session = await auth();
  const sid = session?.sid;
  const userId = session?.user?.id;

  if (sid) {
    await revokeSession(sid);
    await auditNow({
      actorUserId: userId ?? null,
      actorRole: 'SELF',
      action: 'session.sign_out',
      resourceType: 'Session',
      resourceId: sid,
    });
  }

  await signOut({ redirectTo: '/' });
}

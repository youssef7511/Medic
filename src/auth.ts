import NextAuth, { CredentialsSignin } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { UserStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { verifyPassword, fakeVerify } from '@/lib/auth/password';
import { rolesRequireMfa, verifyMfaToken } from '@/lib/auth/totp';

// Distinct codes so the UI can ask for a TOTP code without ever revealing
// whether the email/password pair was valid to an unauthenticated caller.
export class MfaRequiredError extends CredentialsSignin {
  code = 'mfa_required';
}
export class MfaEnrollmentRequiredError extends CredentialsSignin {
  code = 'mfa_enrollment_required';
}
export class AccountSuspendedError extends CredentialsSignin {
  code = 'account_suspended';
}

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  totp: z.string().optional(),
});

const SESSION_DAYS = 7;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Credentials requires JWT strategy. Server-side revocation is enforced in
  // getCurrentActor() against the Session table (§10) — the JWT alone is never
  // treated as sufficient proof that a session is still live.
  session: { strategy: 'jwt', maxAge: SESSION_DAYS * 24 * 60 * 60 },
  pages: { signIn: '/fr/login' },
  trustHost: true,

  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
        totp: { label: 'Authentication code', type: 'text' },
      },

      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password, totp } = parsed.data;

        const user = await prisma.user.findUnique({
          where: { email },
          include: { roleAssignments: true },
        });

        // Burn equivalent CPU on unknown accounts so response time doesn't
        // reveal who is registered here (§10).
        if (!user?.passwordHash) {
          await fakeVerify();
          return null;
        }

        if (!(await verifyPassword(password, user.passwordHash))) return null;

        if (user.status !== UserStatus.ACTIVE) throw new AccountSuspendedError();

        // §10: MFA gate for clinical/admin roles. Checked AFTER the password so
        // an attacker without valid credentials learns nothing about MFA state.
        if (rolesRequireMfa(user.roleAssignments)) {
          if (!user.mfaSecret) throw new MfaEnrollmentRequiredError();
          if (!totp) throw new MfaRequiredError();
          if (!verifyMfaToken(totp, user.mfaSecret)) throw new MfaRequiredError();
        }

        // Session row backs immediate revocation (§10): delete/revoke the row
        // and the next request fails, regardless of JWT expiry.
        const rawToken = randomBytes(32).toString('hex');
        const session = await prisma.session.create({
          data: {
            userId: user.id,
            refreshHash: hashToken(rawToken),
            expiresAt: new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000),
          },
        });

        return { id: user.id, email: user.email, sid: session.id };
      },
    }),
  ],

  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.sid = (user as { sid?: string }).sid;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.sub as string;
      (session as { sid?: string }).sid = token.sid as string | undefined;
      return session;
    },
  },
});

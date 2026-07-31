import { authenticator } from 'otplib';
import { Role } from '@prisma/client';

// §10: 2FA is MANDATORY for anyone who can reach clinical data or platform
// controls. Optional for patients (friction there costs bookings, and a
// patient can only reach their own record).
const MFA_REQUIRED_ROLES: ReadonlySet<Role> = new Set([
  Role.DOCTOR,
  Role.DOCTOR_STAFF,
  Role.SUPPORT_ADMIN,
  Role.SUPER_ADMIN,
]);

export function rolesRequireMfa(roles: { role: Role }[]): boolean {
  return roles.some((r) => MFA_REQUIRED_ROLES.has(r.role));
}

// Allow ±1 step (30s) for clock drift. Wider windows meaningfully weaken TOTP.
authenticator.options = { window: 1 };

export function generateMfaSecret(): string {
  return authenticator.generateSecret();
}

/** otpauth:// URI for the enrollment QR code. */
export function buildMfaUri(secret: string, accountEmail: string): string {
  return authenticator.keyuri(accountEmail, 'Medic', secret);
}

export function verifyMfaToken(token: string, secret: string): boolean {
  try {
    return authenticator.verify({ token, secret });
  } catch {
    return false;
  }
}

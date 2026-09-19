import { Role } from '@prisma/client';

export const LOGIN_PORTALS = ['patient', 'doctor', 'admin'] as const;
export type LoginPortal = (typeof LOGIN_PORTALS)[number];

const PORTAL_ROLES: Record<LoginPortal, ReadonlySet<Role>> = {
  patient: new Set([Role.PATIENT]),
  doctor: new Set([Role.DOCTOR, Role.DOCTOR_STAFF]),
  admin: new Set([Role.SUPER_ADMIN, Role.SUPPORT_ADMIN]),
};

const PORTAL_PREFIX: Record<LoginPortal, string> = {
  patient: '/p',
  doctor: '/d',
  admin: '/admin',
};

export function rolesAllowPortal(
  assignments: Array<{ role: Role; expiresAt?: Date | null }>,
  portal: LoginPortal,
  now = new Date(),
): boolean {
  const allowed = PORTAL_ROLES[portal];
  return assignments.some(
    (assignment) =>
      allowed.has(assignment.role) &&
      (!assignment.expiresAt || assignment.expiresAt.getTime() > now.getTime()),
  );
}

export function portalLanding(portal: LoginPortal, locale: string): string {
  return `/${locale}${PORTAL_PREFIX[portal]}`;
}

export function portalOwnsPath(portal: LoginPortal, path: string, locale: string): boolean {
  const prefix = PORTAL_PREFIX[portal];
  const localePrefix = `/${locale}${prefix}`;
  return path === localePrefix || path.startsWith(`${localePrefix}/`);
}

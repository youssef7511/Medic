// §5: the permission vocabulary and the role→permission matrix.
//
// Roles answer "what kind of action". They do NOT answer "on whose data" —
// that second question is the link check in guard.ts. Both are required on
// every clinical request. Deny by default: absence from a role's set is denial.

export const PERMISSIONS = [
  // Patient self-service
  'appointment:book',
  'appointment:cancel:own',
  'document:read:own',
  'document:share', // patient shares a doc with another doctor (§2)
  'message:read:own',
  'message:send:own',
  'allergy:write:own', // §3.1

  // Calendar / scheduling (doctor + staff)
  'calendar:read',
  'appointment:confirm',
  'appointment:cancel', // practice-side cancellation (distinct from a patient's own)
  'appointment:reschedule',
  'appointment:mark_no_show',
  'appointment:complete',

  // Clinical — DOCTOR only, never staff, never admin (§5)
  'note:read',
  'note:write',
  'document:issue',
  'document:read', // treating doctor reads documents they issued on the link (§4b)
  'message:read:clinical',
  'message:send:clinical',
  'allergy:read', // seen on the prescribing screen (§8)

  // Doctor profile
  'doctor_profile:edit:own',

  // Admin
  'doctor:verify_license', // human gate before publish (§10)
  'doctor:publish',
  'role:assign',
  'user:suspend',
  'audit:read',
  'platform_settings:read',
  'platform_settings:write',
  'appointment:admin_override', // logged (§5)
  'break_glass:activate', // time-boxed emergency flow; never standing clinical access
] as const;

export type Permission = (typeof PERMISSIONS)[number];

import { Role } from '@prisma/client';

// The matrix from §5, encoded. SUPER_ADMIN is deliberately NOT granted
// note:read / message:read:clinical — an admin runs the platform, it does not
// read consultations. Break-glass is a separate, audited flow (§5), never a
// standing permission here.
const MATRIX: Record<Role, readonly Permission[]> = {
  [Role.PATIENT]: [
    'appointment:book',
    'appointment:cancel:own',
    'document:read:own',
    'document:share',
    'message:read:own',
    'message:send:own',
    'allergy:write:own',
  ],

  [Role.DOCTOR_STAFF]: [
    'calendar:read',
    'appointment:confirm',
    'appointment:cancel',
    'appointment:reschedule',
    'appointment:mark_no_show',
    'appointment:complete',
    // NOTE the absence of every note:* / clinical message / document:issue.
    // A secretary is blind to clinical content by construction (§5).
  ],

  [Role.DOCTOR]: [
    'calendar:read',
    'appointment:confirm',
    'appointment:cancel',
    'appointment:reschedule',
    'appointment:mark_no_show',
    'appointment:complete',
    'note:read',
    'note:write',
    'document:issue',
    'document:read',
    'message:read:clinical',
    'message:send:clinical',
    'allergy:read',
    'doctor_profile:edit:own',
  ],

  [Role.SUPPORT_ADMIN]: [
    'audit:read',
    'platform_settings:read',
    'appointment:admin_override',
    // No clinical content. No role assignment. No suspend.
  ],

  [Role.SUPER_ADMIN]: [
    'doctor:verify_license',
    'doctor:publish',
    'role:assign',
    'user:suspend',
    'audit:read',
    'platform_settings:read',
    'platform_settings:write',
    'appointment:admin_override',
    'break_glass:activate',
    // Intentionally NO note:read / message:read:clinical. See §5.
  ],
};

export function roleGrants(role: Role, permission: Permission): boolean {
  return MATRIX[role]?.includes(permission) ?? false;
}

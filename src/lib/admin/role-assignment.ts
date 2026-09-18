import { Role, ScopeType } from '@prisma/client';

export const GLOBAL_SCOPE_ID = 'GLOBAL';

export class InvalidRoleScopeError extends Error {
  constructor(message = 'A doctor scope is required for DOCTOR_STAFF.') {
    super(message);
    this.name = 'InvalidRoleScopeError';
  }
}

/**
 * Produces the only two valid role-scope shapes used by the platform.
 * Global roles always receive a concrete sentinel so Prisma compound-unique
 * upserts never need a nullable type assertion.
 */
export function resolveRoleScope(role: Role, requestedScopeId?: string | null): {
  scopeType: ScopeType;
  scopeId: string;
} {
  if (role === Role.DOCTOR_STAFF) {
    const scopeId = requestedScopeId?.trim();
    if (!scopeId || scopeId === GLOBAL_SCOPE_ID) throw new InvalidRoleScopeError();
    return { scopeType: ScopeType.DOCTOR, scopeId };
  }

  return { scopeType: ScopeType.GLOBAL, scopeId: GLOBAL_SCOPE_ID };
}

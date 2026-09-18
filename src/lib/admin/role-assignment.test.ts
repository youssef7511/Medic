import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Role, ScopeType } from '@prisma/client';
import {
  GLOBAL_SCOPE_ID,
  InvalidRoleScopeError,
  resolveRoleScope,
} from './role-assignment';

test('global roles use a stable non-null scope id', () => {
  assert.deepEqual(resolveRoleScope(Role.SUPER_ADMIN), {
    scopeType: ScopeType.GLOBAL,
    scopeId: GLOBAL_SCOPE_ID,
  });
  assert.deepEqual(resolveRoleScope(Role.DOCTOR, 'ignored-doctor-id'), {
    scopeType: ScopeType.GLOBAL,
    scopeId: GLOBAL_SCOPE_ID,
  });
});

test('doctor staff must be scoped to a concrete doctor profile', () => {
  assert.deepEqual(resolveRoleScope(Role.DOCTOR_STAFF, ' doctor-123 '), {
    scopeType: ScopeType.DOCTOR,
    scopeId: 'doctor-123',
  });
  assert.throws(() => resolveRoleScope(Role.DOCTOR_STAFF), InvalidRoleScopeError);
  assert.throws(
    () => resolveRoleScope(Role.DOCTOR_STAFF, GLOBAL_SCOPE_ID),
    InvalidRoleScopeError,
  );
});

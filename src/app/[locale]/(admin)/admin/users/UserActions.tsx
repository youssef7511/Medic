'use client';

import { useState, useActionState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  suspendUserAction,
  reactivateUserAction,
  assignRoleAction,
  issueMfaEnrollmentTokenAction,
  type UserActionState,
} from './actions';

/**
 * User action controls (§6). Shows suspend/reactivate + role assignment.
 * SUPER_ADMIN only — the page gates with hasPermission.
 */
export function UserActions({
  userId,
  userName,
  currentStatus,
  mfaEnrolled,
  locale,
}: {
  userId: string;
  userName: string;
  currentStatus: string;
  mfaEnrolled: boolean;
  locale: string;
}) {
  const ar = locale === 'ar';
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [selectedRole, setSelectedRole] = useState('');

  const [suspendState, suspendAction, suspendPending] = useActionState<UserActionState, FormData>(
    suspendUserAction,
    {},
  );
  const [reactivateState, reactivateAction, reactivatePending] = useActionState<UserActionState, FormData>(
    reactivateUserAction,
    {},
  );
  const [roleState, roleFormAction, rolePending] = useActionState<UserActionState, FormData>(
    assignRoleAction,
    {},
  );
  const [mfaState, mfaAction, mfaPending] = useActionState<UserActionState, FormData>(
    issueMfaEnrollmentTokenAction,
    {},
  );

  function handleSuspend() {
    const fd = new FormData();
    fd.set('userId', userId);
    suspendAction(fd);
  }

  function handleReactivate() {
    const fd = new FormData();
    fd.set('userId', userId);
    reactivateAction(fd);
  }

  function handleAssignRole() {
    if (!selectedRole) return;
    const fd = new FormData();
    fd.set('userId', userId);
    fd.set('role', selectedRole);
    roleFormAction(fd);
    setRoleDialogOpen(false);
    setSelectedRole('');
  }

  function handleIssueMfaToken() {
    const fd = new FormData();
    fd.set('userId', userId);
    mfaAction(fd);
  }

  return (
    <div className="flex items-center gap-2">
      {currentStatus === 'ACTIVE' ? (
        <Button type="button" size="sm" variant="destructive" onClick={handleSuspend} disabled={suspendPending}>
          {ar ? 'تعليق' : 'Suspendre'}
        </Button>
      ) : (
        <Button type="button" size="sm" variant="outline" onClick={handleReactivate} disabled={reactivatePending}>
          {ar ? 'تفعيل' : 'Réactiver'}
        </Button>
      )}

      <Button type="button" size="sm" variant="ghost" onClick={() => setRoleDialogOpen(true)}>
        {ar ? 'دور' : 'Rôle'}
      </Button>

      {!mfaEnrolled && (
        <Button type="button" size="sm" variant="outline" onClick={handleIssueMfaToken} disabled={mfaPending}>
          {ar ? 'رمز MFA' : 'Jeton MFA'}
        </Button>
      )}

      {(suspendState.error || reactivateState.error || roleState.error || mfaState.error) && (
        <p role="alert" className="text-xs text-red-600">
          {suspendState.error || reactivateState.error || roleState.error || mfaState.error}
        </p>
      )}
      {(suspendState.ok || reactivateState.ok || roleState.ok) && (
        <p className="text-xs text-green-600">{ar ? 'تم' : 'Fait'}</p>
      )}

      {mfaState.enrollmentToken && (
        <div className="max-w-sm rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
          <p className="font-semibold">
            {ar ? 'انسخ الرمز الآن — سيظهر مرة واحدة فقط.' : 'Copiez maintenant — ce jeton ne sera affiché qu’une fois.'}
          </p>
          <code className="mt-1 block break-all select-all">{mfaState.enrollmentToken}</code>
          <p className="mt-1 text-amber-700">
            {ar ? 'تنتهي الصلاحية خلال 30 دقيقة.' : 'Expiration dans 30 minutes.'}
          </p>
        </div>
      )}

      <Dialog open={roleDialogOpen} onOpenChange={setRoleDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {ar ? `تعيين دور لـ ${userName}` : `Assigner un rôle à ${userName}`}
            </DialogTitle>
          </DialogHeader>

          <select
            value={selectedRole}
            onChange={(e) => setSelectedRole(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">{ar ? 'اختر دورًا…' : 'Sélectionner un rôle…'}</option>
            <option value="DOCTOR">DOCTOR</option>
            <option value="DOCTOR_STAFF">DOCTOR_STAFF</option>
            <option value="SUPPORT_ADMIN">SUPPORT_ADMIN</option>
            <option value="SUPER_ADMIN">SUPER_ADMIN</option>
          </select>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setRoleDialogOpen(false)}>
              {ar ? 'إلغاء' : 'Annuler'}
            </Button>
            <Button type="button" disabled={!selectedRole || rolePending} onClick={handleAssignRole}>
              {ar ? 'تعيين' : 'Assigner'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

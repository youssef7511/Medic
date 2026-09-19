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
  userEmail,
  currentStatus,
  mfaEnrolled,
  doctorOptions,
  locale,
}: {
  userId: string;
  userEmail: string;
  currentStatus: string;
  mfaEnrolled: boolean;
  doctorOptions: Array<{ id: string; label: string }>;
  locale: string;
}) {
  const ar = locale === 'ar';
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [selectedRole, setSelectedRole] = useState('');
  const [selectedDoctorId, setSelectedDoctorId] = useState('');

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
    if (selectedRole === 'DOCTOR_STAFF' && !selectedDoctorId) return;
    const fd = new FormData();
    fd.set('userId', userId);
    fd.set('role', selectedRole);
    if (selectedRole === 'DOCTOR_STAFF') fd.set('scopeId', selectedDoctorId);
    roleFormAction(fd);
    setRoleDialogOpen(false);
    setSelectedRole('');
    setSelectedDoctorId('');
  }

  function handleIssueMfaToken() {
    const fd = new FormData();
    fd.set('userId', userId);
    mfaAction(fd);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
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
        <div className="max-w-sm rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
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
              {ar ? `تعيين دور لـ ${userEmail}` : `Assigner un rôle à ${userEmail}`}
            </DialogTitle>
          </DialogHeader>

          <select
            value={selectedRole}
            onChange={(e) => {
              setSelectedRole(e.target.value);
              if (e.target.value !== 'DOCTOR_STAFF') setSelectedDoctorId('');
            }}
            className="medic-input"
          >
            <option value="">{ar ? 'اختر دورًا…' : 'Sélectionner un rôle…'}</option>
            <option value="DOCTOR">DOCTOR</option>
            <option value="DOCTOR_STAFF">DOCTOR_STAFF</option>
            <option value="SUPPORT_ADMIN">SUPPORT_ADMIN</option>
            <option value="SUPER_ADMIN">SUPER_ADMIN</option>
          </select>

          {selectedRole === 'DOCTOR_STAFF' && (
            <div>
              <label htmlFor={`doctor-scope-${userId}`} className="mb-1 block text-sm font-medium">
                {ar ? 'الطبيب المرتبط بهذا الحساب' : 'Médecin rattaché à ce compte'}
              </label>
              <select
                id={`doctor-scope-${userId}`}
                value={selectedDoctorId}
                onChange={(event) => setSelectedDoctorId(event.target.value)}
                className="medic-input"
              >
                <option value="">{ar ? 'اختر طبيبًا…' : 'Sélectionner un médecin…'}</option>
                {doctorOptions.map((doctor) => (
                  <option key={doctor.id} value={doctor.id}>{doctor.label}</option>
                ))}
              </select>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setRoleDialogOpen(false)}>
              {ar ? 'إلغاء' : 'Annuler'}
            </Button>
            <Button
              type="button"
              disabled={!selectedRole || (selectedRole === 'DOCTOR_STAFF' && !selectedDoctorId) || rolePending}
              onClick={handleAssignRole}
            >
              {ar ? 'تعيين' : 'Assigner'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

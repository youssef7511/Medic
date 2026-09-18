'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { verifyLicenseAction, publishDoctorAction, type VerifyState } from './actions';

/**
 * Doctor verification button (§10). Shows "Verify" if not yet verified,
 * then "Publish" if verified but not published. SUPER_ADMIN only.
 */
export function VerifyDoctorButton({
  doctorId,
  doctorName,
  isPublished,
  canPublish,
  locale,
}: {
  doctorId: string;
  doctorName: string;
  isPublished: boolean;
  canPublish: boolean;
  locale: string;
}) {
  const ar = locale === 'ar';
  const [verifyState, verifyAction, verifyPending] = useActionState<VerifyState, FormData>(
    verifyLicenseAction,
    {},
  );
  const [publishState, publishAction, publishPending] = useActionState<VerifyState, FormData>(
    publishDoctorAction,
    {},
  );

  if (isPublished) return null;

  return (
    <div className="flex flex-col items-end gap-2">
      <form action={verifyAction}>
        <input type="hidden" name="doctorId" value={doctorId} />
        <Button type="submit" size="sm" variant="outline" disabled={verifyPending}>
          {ar ? 'تحقق من الترخيص' : 'Vérifier la licence'}
        </Button>
      </form>

      {canPublish && (
        <form action={publishAction}>
          <input type="hidden" name="doctorId" value={doctorId} />
          <Button type="submit" size="sm" disabled={publishPending}>
            {ar ? 'نشر الملف' : 'Publier le profil'}
          </Button>
        </form>
      )}

      {verifyState.error && (
        <p role="alert" className="text-xs text-red-600">{verifyState.error}</p>
      )}
      {publishState.error && (
        <p role="alert" className="text-xs text-red-600">{publishState.error}</p>
      )}
      {verifyState.ok && (
        <p className="text-xs text-green-600">
          {ar ? 'تم التحقق' : 'Licence vérifiée'}
        </p>
      )}
      {publishState.ok && (
        <p className="text-xs text-green-600">
          {ar ? 'تم النشر' : 'Profil publié'}
        </p>
      )}
    </div>
  );
}

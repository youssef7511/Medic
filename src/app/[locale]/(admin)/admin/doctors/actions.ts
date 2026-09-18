'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentActor } from '@/lib/auth/session';
import { hasPermission, ResourceNotFoundError } from '@/lib/rbac/guard';
import { prisma } from '@/lib/db';
import { audit } from '@/lib/audit';
import { Role } from '@prisma/client';

export type VerifyState = { error?: string; ok?: boolean };

/**
 * Verify a doctor's license (§10). This is a MANUAL human gate — never
 * automated. After verification, the doctor can be published.
 *
 * Only SUPER_ADMIN can verify (§5).
 */
export async function verifyLicenseAction(
  _prev: VerifyState,
  formData: FormData,
): Promise<VerifyState> {
  const actor = await getCurrentActor();
  if (!actor) return { error: 'Please sign in again.' };
  if (!hasPermission(actor, 'doctor:verify_license')) {
    return { error: 'Permission denied.' };
  }

  const doctorId = formData.get('doctorId') as string;
  if (!doctorId) return { error: 'Missing doctorId.' };

  const doctor = await prisma.doctorProfile.findUnique({
    where: { id: doctorId },
    select: { id: true, licenseNumber: true },
  });
  if (!doctor) throw new ResourceNotFoundError();

  await audit(prisma, {
    actorUserId: actor.userId,
    actorRole: Role.SUPER_ADMIN,
    action: 'doctor.license_verified',
    resourceType: 'DoctorProfile',
    resourceId: doctorId,
    metadata: { licenseNumber: doctor.licenseNumber },
  });

  revalidatePath('/admin/doctors');
  return { ok: true };
}

/**
 * Publish a doctor's profile (§10). Makes the profile visible in the public
 * directory and allows the doctor to enter the platform.
 *
 * Only SUPER_ADMIN can publish (§5).
 */
export async function publishDoctorAction(
  _prev: VerifyState,
  formData: FormData,
): Promise<VerifyState> {
  const actor = await getCurrentActor();
  if (!actor) return { error: 'Please sign in again.' };
  if (!hasPermission(actor, 'doctor:publish')) {
    return { error: 'Permission denied.' };
  }

  const doctorId = formData.get('doctorId') as string;
  if (!doctorId) return { error: 'Missing doctorId.' };

  const doctor = await prisma.doctorProfile.findUnique({
    where: { id: doctorId },
    select: { id: true, isPublished: true },
  });
  if (!doctor) throw new ResourceNotFoundError();
  if (doctor.isPublished) return { error: 'Already published.' };

  await prisma.$transaction(async (tx) => {
    await tx.doctorProfile.update({
      where: { id: doctorId },
      data: { isPublished: true },
    });

    await audit(tx, {
      actorUserId: actor.userId,
      actorRole: Role.SUPER_ADMIN,
      action: 'doctor.published',
      resourceType: 'DoctorProfile',
      resourceId: doctorId,
    });
  });

  revalidatePath('/admin/doctors');
  return { ok: true };
}

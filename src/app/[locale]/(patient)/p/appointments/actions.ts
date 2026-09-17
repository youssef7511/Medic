'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getCurrentActor } from '@/lib/auth/session';
import { ResourceNotFoundError } from '@/lib/rbac/guard';
import { cancelAppointment, AppointmentClosedError } from '@/lib/booking/lifecycle';
import { InvalidTransitionError } from '@/lib/booking/state';

export type CancelState = { error?: string; ok?: boolean };

const schema = z.object({
  appointmentId: z.string().min(1),
  reason: z.string().trim().max(500).optional(),
});

export async function cancelAppointmentAction(
  _prev: CancelState,
  formData: FormData,
): Promise<CancelState> {
  const actor = await getCurrentActor();
  if (!actor) return { error: 'Please sign in again.' };

  const parsed = schema.safeParse({
    appointmentId: formData.get('appointmentId'),
    reason: formData.get('reason') || undefined,
  });
  if (!parsed.success) return { error: 'Invalid request.' };

  try {
    await cancelAppointment({
      actor,
      appointmentId: parsed.data.appointmentId,
      ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
    });
  } catch (e) {
    // A resource outside the actor's scope is reported as "not found", matching
    // the guard's 404-not-403 rule (§5).
    if (e instanceof ResourceNotFoundError) return { error: 'Appointment not found.' };
    if (e instanceof AppointmentClosedError || e instanceof InvalidTransitionError) {
      return { error: e.message };
    }
    throw e;
  }

  revalidatePath('/p/appointments');
  return { ok: true };
}

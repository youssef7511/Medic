'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getCurrentActor } from '@/lib/auth/session';
import { ResourceNotFoundError } from '@/lib/rbac/guard';
import {
  cancelAppointment,
  confirmAppointment,
  completeAppointment,
  markNoShow,
  AppointmentClosedError,
} from '@/lib/booking/lifecycle';
import { InvalidTransitionError } from '@/lib/booking/state';

export type DoctorActionState = { error?: string; ok?: boolean };

const schema = z.object({
  appointmentId: z.string().min(1),
  action: z.enum(['confirm', 'decline', 'complete', 'no_show']),
});

/**
 * The practice side of the appointment lifecycle. "Decline" is a cancellation
 * performed by the doctor on a REQUESTED appointment — the §13.2 vetted flow
 * needs both an accept and a refuse, and the state machine already models a
 * refusal as CANCELLED rather than inventing a separate terminal state.
 */
export async function appointmentAction(
  _prev: DoctorActionState,
  formData: FormData,
): Promise<DoctorActionState> {
  const actor = await getCurrentActor();
  if (!actor) return { error: 'Please sign in again.' };

  const parsed = schema.safeParse({
    appointmentId: formData.get('appointmentId'),
    action: formData.get('action'),
  });
  if (!parsed.success) return { error: 'Invalid request.' };

  const { appointmentId, action } = parsed.data;

  try {
    switch (action) {
      case 'confirm':
        await confirmAppointment({ actor, appointmentId });
        break;
      case 'decline':
        await cancelAppointment({ actor, appointmentId, reason: 'Declined by the practice' });
        break;
      case 'complete':
        await completeAppointment({ actor, appointmentId });
        break;
      case 'no_show':
        await markNoShow({ actor, appointmentId });
        break;
    }
  } catch (e) {
    if (e instanceof ResourceNotFoundError) return { error: 'Appointment not found.' };
    if (e instanceof AppointmentClosedError || e instanceof InvalidTransitionError) {
      return { error: e.message };
    }
    throw e;
  }

  revalidatePath('/d');
  return { ok: true };
}

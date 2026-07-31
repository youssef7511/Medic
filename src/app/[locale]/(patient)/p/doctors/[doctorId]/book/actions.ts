'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getCurrentActor } from '@/lib/auth/session';
import { requirePermission } from '@/lib/rbac/guard';
import { bookAppointment, SlotUnavailableError } from '@/lib/booking/book';

export type BookFormState = { status: 'idle' | 'booked' | 'error'; message?: string };

const schema = z.object({
  doctorId: z.string().min(1),
  clinicId: z.string().min(1),
  startAt: z.string().datetime(),
  // Reason-for-visit is sensitive (§3.1) — kept short and encrypted at rest.
  reason: z.string().trim().max(500).optional(),
});

export async function bookSlotAction(
  _prev: BookFormState,
  formData: FormData,
): Promise<BookFormState> {
  const actor = await getCurrentActor();
  if (!actor) return { status: 'error', message: 'Please sign in again.' };

  // Role check (question 1 of §5). The link doesn't exist yet on a first
  // booking, so there's no link to scope against — bookAppointment creates it.
  try {
    requirePermission(actor, 'appointment:book');
  } catch {
    return { status: 'error', message: 'Not permitted.' };
  }

  const parsed = schema.safeParse({
    doctorId: formData.get('doctorId'),
    clinicId: formData.get('clinicId'),
    startAt: formData.get('startAt'),
    reason: formData.get('reason') || undefined,
  });
  if (!parsed.success) return { status: 'error', message: 'Invalid booking request.' };

  try {
    await bookAppointment({
      userId: actor.userId,
      doctorId: parsed.data.doctorId,
      clinicId: parsed.data.clinicId,
      startAt: new Date(parsed.data.startAt),
      ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
    });
  } catch (e) {
    if (e instanceof SlotUnavailableError) {
      // The common race: someone else took it between render and submit.
      return { status: 'error', message: e.message };
    }
    throw e;
  }

  revalidatePath('/p');
  return { status: 'booked' };
}

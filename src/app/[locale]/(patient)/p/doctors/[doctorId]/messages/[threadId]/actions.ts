'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getCurrentActor } from '@/lib/auth/session';
import { ResourceNotFoundError } from '@/lib/rbac/guard';
import { sendMessage, MessageValidationError } from '@/lib/messaging/threads';

export type MessageState = { error?: string; ok?: boolean };

const sendSchema = z.object({
  locale: z.string().default('fr'),
  threadId: z.string().min(1),
  body: z.string().min(1),
  doctorId: z.string().min(1),
});

export async function sendMessageAction(
  _prev: MessageState,
  formData: FormData,
): Promise<MessageState> {
  const actor = await getCurrentActor();
  if (!actor) return { error: 'Please sign in again.' };

  const parsed = sendSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Invalid input.' };
  const { threadId, body, locale, doctorId } = parsed.data;

  try {
    await sendMessage(actor, { threadId, body });
    revalidatePath(`/p/doctors/${doctorId}/messages/${threadId}`);
    revalidatePath(`/p/doctors/${doctorId}/messages`);
    return { ok: true };
  } catch (e: unknown) {
    if (e instanceof ResourceNotFoundError) return { error: locale === 'ar' ? 'غير موجود.' : 'Non trouvé.' };
    if (e instanceof MessageValidationError) {
      const messages: Record<string, { fr: string; ar: string }> = {
        empty: { fr: 'Le message ne peut pas être vide.', ar: 'لا يمكن أن يكون الرسالة فارغة.' },
        too_long: { fr: 'Le message est trop long.', ar: 'الرسالة طويلة جدًا.' },
      };
      const msg = messages[e.code];
      return { error: msg ? (locale === 'ar' ? msg.ar : msg.fr) : e.message };
    }
    throw e;
  }
}

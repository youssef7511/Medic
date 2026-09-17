'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getCurrentActor } from '@/lib/auth/session';
import { hasPermission, type Actor } from '@/lib/rbac/guard';
import { audit } from '@/lib/audit';
import { validateRule, RULE_ERROR_MESSAGES, type RuleError } from '@/lib/booking/validation';

export type AvailabilityState = { error?: string; ok?: boolean };

/**
 * Availability is practice configuration, not clinical data, so it's gated by
 * role + ownership rather than a PatientDoctorLink (§5). The ownership check is
 * the important half: every mutation resolves the doctor profile FROM THE
 * SESSION and scopes the write by that id, so a doctorId can never be supplied
 * by the client.
 */
async function requireOwnDoctor(
  actor: Actor,
  permission: 'doctor_profile:edit:own' | 'calendar:read',
) {
  if (!hasPermission(actor, permission)) return null;
  return prisma.doctorProfile.findUnique({
    where: { userId: actor.userId },
    select: { id: true },
  });
}

function firstMessage(errors: RuleError[], locale: string): string {
  const key = errors[0]!;
  const msg = RULE_ERROR_MESSAGES[key];
  return locale === 'ar' ? msg.ar : msg.fr;
}

const ruleSchema = z.object({
  locale: z.string().default('fr'),
  clinicId: z.string().min(1),
  weekday: z.coerce.number().int().min(0).max(6),
  startLocal: z.string().min(1),
  endLocal: z.string().min(1),
  slotMinutes: z.coerce.number().int(),
});

export async function createRuleAction(
  _prev: AvailabilityState,
  formData: FormData,
): Promise<AvailabilityState> {
  const actor = await getCurrentActor();
  if (!actor) return { error: 'Please sign in again.' };

  const doctor = await requireOwnDoctor(actor, 'doctor_profile:edit:own');
  if (!doctor) return { error: 'Not permitted.' };

  const parsed = ruleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Invalid input.' };
  const { locale, clinicId, ...draft } = parsed.data;

  // The clinic must belong to THIS doctor, or a client could attach hours to
  // someone else's clinic.
  const clinic = await prisma.clinic.findFirst({
    where: { id: clinicId, doctorId: doctor.id },
    select: { id: true },
  });
  if (!clinic) return { error: 'Unknown clinic.' };

  const existing = await prisma.availabilityRule.findMany({
    where: { doctorId: doctor.id, clinicId },
    select: { id: true, weekday: true, startLocal: true, endLocal: true, slotMinutes: true },
  });

  const errors = validateRule(draft, existing);
  if (errors.length > 0) return { error: firstMessage(errors, locale) };

  await prisma.$transaction(async (tx) => {
    const rule = await tx.availabilityRule.create({
      data: {
        doctorId: doctor.id,
        clinicId,
        weekday: draft.weekday,
        startLocal: draft.startLocal,
        endLocal: draft.endLocal,
        slotMinutes: draft.slotMinutes,
        validFrom: new Date(),
      },
    });
    await audit(tx, {
      actorUserId: actor.userId,
      actorRole: Role.DOCTOR,
      action: 'availability.rule_create',
      resourceType: 'AvailabilityRule',
      resourceId: rule.id,
      metadata: { weekday: draft.weekday, startLocal: draft.startLocal, endLocal: draft.endLocal },
    });
  });

  revalidatePath('/d/availability');
  revalidatePath('/d/calendar');
  return { ok: true };
}

export async function deleteRuleAction(
  _prev: AvailabilityState,
  formData: FormData,
): Promise<AvailabilityState> {
  const actor = await getCurrentActor();
  if (!actor) return { error: 'Please sign in again.' };

  const doctor = await requireOwnDoctor(actor, 'doctor_profile:edit:own');
  if (!doctor) return { error: 'Not permitted.' };

  const id = String(formData.get('ruleId') ?? '');
  if (!id) return { error: 'Invalid input.' };

  // deleteMany scoped by doctorId: a rule belonging to another practice simply
  // matches nothing, rather than erroring in a way that confirms it exists.
  const result = await prisma.availabilityRule.deleteMany({
    where: { id, doctorId: doctor.id },
  });
  if (result.count === 0) return { error: 'Not found.' };

  await audit(prisma, {
    actorUserId: actor.userId,
    actorRole: Role.DOCTOR,
    action: 'availability.rule_delete',
    resourceType: 'AvailabilityRule',
    resourceId: id,
  });

  revalidatePath('/d/availability');
  revalidatePath('/d/calendar');
  return { ok: true };
}

const exceptionSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  isClosed: z.string().optional(),
  startLocal: z.string().optional(),
  endLocal: z.string().optional(),
});

export async function upsertExceptionAction(
  _prev: AvailabilityState,
  formData: FormData,
): Promise<AvailabilityState> {
  const actor = await getCurrentActor();
  if (!actor) return { error: 'Please sign in again.' };

  const doctor = await requireOwnDoctor(actor, 'doctor_profile:edit:own');
  if (!doctor) return { error: 'Not permitted.' };

  const parsed = exceptionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Invalid date.' };

  const isClosed = parsed.data.isClosed === 'on' || parsed.data.isClosed === 'true';
  const start = parsed.data.startLocal?.trim() || null;
  const end = parsed.data.endLocal?.trim() || null;

  if (!isClosed && (!start || !end)) {
    return { error: 'Provide both a start and an end time, or mark the day closed.' };
  }

  // Stored as a bare calendar date (@db.Date) — no instant, no timezone.
  const date = new Date(`${parsed.data.date}T00:00:00Z`);

  const existing = await prisma.availabilityException.findFirst({
    where: { doctorId: doctor.id, date },
    select: { id: true },
  });

  await prisma.$transaction(async (tx) => {
    const row = existing
      ? await tx.availabilityException.update({
          where: { id: existing.id },
          data: { isClosed, startLocal: start, endLocal: end },
        })
      : await tx.availabilityException.create({
          data: { doctorId: doctor.id, date, isClosed, startLocal: start, endLocal: end },
        });

    await audit(tx, {
      actorUserId: actor.userId,
      actorRole: Role.DOCTOR,
      action: 'availability.exception_upsert',
      resourceType: 'AvailabilityException',
      resourceId: row.id,
      metadata: { date: parsed.data.date, isClosed },
    });
  });

  revalidatePath('/d/availability');
  revalidatePath('/d/calendar');
  return { ok: true };
}

export async function deleteExceptionAction(
  _prev: AvailabilityState,
  formData: FormData,
): Promise<AvailabilityState> {
  const actor = await getCurrentActor();
  if (!actor) return { error: 'Please sign in again.' };

  const doctor = await requireOwnDoctor(actor, 'doctor_profile:edit:own');
  if (!doctor) return { error: 'Not permitted.' };

  const id = String(formData.get('exceptionId') ?? '');
  const result = await prisma.availabilityException.deleteMany({
    where: { id, doctorId: doctor.id },
  });
  if (result.count === 0) return { error: 'Not found.' };

  revalidatePath('/d/availability');
  revalidatePath('/d/calendar');
  return { ok: true };
}

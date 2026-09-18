// §5: the guard. Every clinical data path goes through here. No exceptions.
//
// Two questions, always both:
//   1. Does this actor's ROLE grant the permission?      → roleGrants()
//   2. Is the target resource WITHIN this actor's scope?  → requireLink()
//
// Rule 1 — deny by default. Not in the set means denied.
// Rule 2 — out-of-scope resources return NOT FOUND, never Forbidden. A 403
//          confirms the id is real, which is itself a leak. See §5.

import { Role, ScopeType, type PatientDoctorLink, type RoleAssignment } from '@prisma/client';
import { prisma } from '@/lib/db';
import { roleGrants, type Permission } from './permissions';

export interface Actor {
  userId: string;
  roles: RoleAssignment[];
}

/** Thrown when a resource is out of the actor's scope. Surfaced to the client
 *  as 404 — deliberately indistinguishable from "does not exist". */
export class ResourceNotFoundError extends Error {
  constructor(message = 'Not found') {
    super(message);
    this.name = 'ResourceNotFoundError';
  }
}

/** Thrown when the actor's role lacks the permission outright (not a scope
 *  issue — the actor simply may never do this). */
export class PermissionDeniedError extends Error {
  constructor(message = 'Permission denied') {
    super(message);
    this.name = 'PermissionDeniedError';
  }
}

function activeRoles(actor: Actor): RoleAssignment[] {
  const now = Date.now();
  return actor.roles.filter((r) => !r.expiresAt || r.expiresAt.getTime() > now);
}

/** Question 1 only: does any of the actor's roles grant this permission? */
export function hasPermission(actor: Actor, permission: Permission): boolean {
  return activeRoles(actor).some((r) => roleGrants(r.role, permission));
}

/** Assert question 1. Throws PermissionDeniedError if no role grants it. */
export function requirePermission(actor: Actor, permission: Permission): void {
  if (!hasPermission(actor, permission)) {
    throw new PermissionDeniedError(`Missing permission: ${permission}`);
  }
}

/**
 * Question 1 AND question 2, together — the primary entry point for anything
 * scoped to a patient↔doctor relationship.
 *
 * Resolves the link, verifies the actor's role grants `permission`, and
 * verifies the actor actually stands on one side of THIS link. Any failure
 * throws ResourceNotFoundError (→ 404) so an attacker learns nothing about
 * whether the link exists.
 */
export async function requireLink(
  actor: Actor,
  linkId: string,
  permission: Permission,
): Promise<PatientDoctorLink> {
  const roles = activeRoles(actor);

  // Question 1 first — cheap, and a role that can never hold this permission
  // shouldn't even trigger a lookup.
  if (!roles.some((r) => roleGrants(r.role, permission))) {
    throw new ResourceNotFoundError();
  }

  const link = await prisma.patientDoctorLink.findUnique({
    where: { id: linkId },
    include: {
      patient: { select: { userId: true } },
      doctor: { select: { id: true, userId: true } },
    },
  });

  if (!link || link.status === 'BLOCKED') {
    throw new ResourceNotFoundError();
  }

  // Question 2 — is the actor on this link, in a role that grants the permission?
  const onLink = roles.some((r) => {
    if (!roleGrants(r.role, permission)) return false;

    switch (r.role) {
      case Role.PATIENT:
        return link.patient.userId === actor.userId;

      case Role.DOCTOR:
        // The treating doctor: owns the doctorProfile this link points at.
        return link.doctor.userId === actor.userId;

      case Role.DOCTOR_STAFF:
        // Staff scoped to this specific doctor (§5). GLOBAL staff is not a thing.
        return r.scopeType === ScopeType.DOCTOR && r.scopeId === link.doctor.id;

      // Admin roles never reach clinical content through this path (§5).
      default:
        return false;
    }
  });

  if (!onLink) {
    throw new ResourceNotFoundError();
  }

  // Strip the includes before returning the bare link.
  const { patient: _p, doctor: _d, ...bare } = link;
  return bare as PatientDoctorLink;
}

/**
 * Succeeds if ANY of the given permissions authorizes the actor on this link.
 *
 * Needed because one human can hold two roles: a doctor is also somebody's
 * patient. Checking only the doctor-side permission would 404 them on their own
 * appointment with a different physician. Each attempt still runs the full
 * two-question check, so this widens the entry points, never the scope.
 */
export async function requireLinkAny(
  actor: Actor,
  linkId: string,
  permissions: Permission[],
): Promise<PatientDoctorLink> {
  for (const permission of permissions) {
    try {
      return await requireLink(actor, linkId, permission);
    } catch (e) {
      if (!(e instanceof ResourceNotFoundError)) throw e;
    }
  }
  throw new ResourceNotFoundError();
}

/**
 * Succeeds if the actor passes requireLinkAny on the document's link,
 * OR is a DOCTOR with an ACTIVE DocumentShare on this document.
 *
 * The first path is the fast path (same-link, no extra query). The share
 * path fires only when the link check failed — a cold read for shared docs.
 *
 * Both paths preserve the 404-not-403 discipline (§5).
 */
export async function requireLinkOrShare(
  actor: Actor,
  documentId: string,
  permissions: Permission[],
): Promise<{ patientId: string; via: 'link' | 'share'; shareId?: string }> {
  // Load the document to find its link (for the link path) and patientId.
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      linkId: true,
      link: { select: { patientId: true } },
    },
  });
  if (!doc) throw new ResourceNotFoundError();

  const patientId = doc.link.patientId;

  // Fast path: does the actor have a same-link authorization?
  for (const permission of permissions) {
    try {
      await requireLink(actor, doc.linkId, permission);
      return { patientId, via: 'link' };
    } catch (e) {
      if (!(e instanceof ResourceNotFoundError)) throw e;
    }
  }

  // Slow path: is the actor a DOCTOR with an ACTIVE share on this document?
  // Question 1 — does any role grant document:read at all?
  if (!hasPermission(actor, 'document:read')) {
    throw new ResourceNotFoundError();
  }

  // A DOCTOR role is global; ownership is anchored by DoctorProfile.userId.
  // Only DOCTOR_STAFF carries a doctorProfile id in its role scope.
  const doctorRole = activeRoles(actor).find((r) => r.role === Role.DOCTOR);
  if (!doctorRole) throw new ResourceNotFoundError();
  const doctor = await prisma.doctorProfile.findUnique({
    where: { userId: actor.userId },
    select: { id: true },
  });
  if (!doctor) throw new ResourceNotFoundError();

  const share = await prisma.documentShare.findUnique({
    where: {
      documentId_doctorId: { documentId, doctorId: doctor.id },
    },
    select: { id: true, status: true },
  });

  if (!share || share.status !== 'ACTIVE') {
    throw new ResourceNotFoundError();
  }

  return { patientId, via: 'share', shareId: share.id };
}

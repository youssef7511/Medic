-- Medic — database hardening the Prisma schema language can't express.
-- Apply AFTER the initial `prisma migrate dev`. In a real pipeline this becomes
-- the body of a dedicated migration (prisma migrate diff --script, then hand-edit).
--
-- See docs/architecture-plan.md §3 and §10.

-- ===========================================================================
-- 1. Double-booking is arbitrated by Postgres, not application code (§3, §6).
--    Two concurrent bookings for the same clinic slot: one commits, the other
--    hits this constraint and we translate the violation into "just taken".
-- ===========================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Appointment"
  ADD COLUMN IF NOT EXISTS period tstzrange
  GENERATED ALWAYS AS (tstzrange("startAt", "endAt", '[)')) STORED;

-- Only REQUESTED/CONFIRMED appointments hold a slot; cancelled/no-show free it.
ALTER TABLE "Appointment"
  ADD CONSTRAINT appointment_no_overlap
  EXCLUDE USING gist ("clinicId" WITH =, period WITH &&)
  WHERE (status IN ('REQUESTED', 'CONFIRMED'));

-- ===========================================================================
-- 2. Row Level Security as the second line of defense (§3).
--    The app-layer guard (src/lib/rbac) is primary; this makes a missing
--    WHERE clause physically unable to leak another practice's clinical rows.
--
--    The app sets `app.current_user_id` per transaction (Prisma middleware).
--    Policies below are a STARTING POINT — expand alongside the guard, and
--    keep them in lockstep with the permission matrix (§5). A migration that
--    adds a table touching clinical data must add its policy in the same PR.
-- ===========================================================================

-- Helper: the doctorProfile.id owned by the current user, if any.
CREATE OR REPLACE FUNCTION current_doctor_id() RETURNS text
  LANGUAGE sql STABLE AS $$
    SELECT dp.id
    FROM "DoctorProfile" dp
    WHERE dp."userId" = current_setting('app.current_user_id', true)
$$;

-- Helper: the patientProfile.id owned by the current user, if any.
CREATE OR REPLACE FUNCTION current_patient_id() RETURNS text
  LANGUAGE sql STABLE AS $$
    SELECT pp.id
    FROM "PatientProfile" pp
    WHERE pp."userId" = current_setting('app.current_user_id', true)
$$;

-- Consultation notes: the authoring doctor only. Never the patient, never
-- another doctor. This mirrors §2 ("private clinical reasoning").
ALTER TABLE "ConsultationNote" ENABLE ROW LEVEL SECURITY;
CREATE POLICY note_doctor_access ON "ConsultationNote"
  USING (
    "linkId" IN (
      SELECT id FROM "PatientDoctorLink"
      WHERE "doctorId" = current_doctor_id()
    )
  );

-- Documents: the treating doctor OR the owning patient (§2, §8).
ALTER TABLE "Document" ENABLE ROW LEVEL SECURITY;
CREATE POLICY document_access ON "Document"
  USING (
    "linkId" IN (
      SELECT id FROM "PatientDoctorLink"
      WHERE "doctorId" = current_doctor_id()
         OR "patientId" = current_patient_id()
    )
  );

-- Messages: either party to the thread's link (§7).
ALTER TABLE "Message" ENABLE ROW LEVEL SECURITY;
CREATE POLICY message_access ON "Message"
  USING (
    "threadId" IN (
      SELECT t.id FROM "MessageThread" t
      JOIN "PatientDoctorLink" l ON l.id = t."linkId"
      WHERE l."doctorId" = current_doctor_id()
         OR l."patientId" = current_patient_id()
    )
  );

-- ===========================================================================
-- 3. Audit log is append-only (§10).
--    Application connects as a role that can INSERT and SELECT but never
--    UPDATE/DELETE, so app code physically cannot rewrite history.
--    (Run once, against your actual application DB role.)
-- ===========================================================================

-- Example — adjust the role name to your deployment:
--   REVOKE UPDATE, DELETE ON "AuditLog" FROM medic_app;
--   GRANT  INSERT, SELECT ON "AuditLog" TO   medic_app;

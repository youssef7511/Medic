-- Database hardening the Prisma schema language cannot express (§3, §10).
--
-- This was originally applied by hand from prisma/sql/001_hardening.sql, which
-- left the migration history out of sync with the database ("drift"). Recording
-- it as a migration makes a fresh environment reproducible and stops
-- `prisma migrate dev` from demanding a destructive reset.
--
-- On the existing development database this migration is marked as already
-- applied (`prisma migrate resolve --applied`) rather than re-run.

-- ===========================================================================
-- 1. Double-booking is arbitrated by Postgres, not application code (§3, §6).
-- ===========================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Appointment"
  ADD COLUMN IF NOT EXISTS period tstzrange
  GENERATED ALWAYS AS (tstzrange("startAt", "endAt", '[)')) STORED;

ALTER TABLE "Appointment"
  ADD CONSTRAINT appointment_no_overlap
  EXCLUDE USING gist ("clinicId" WITH =, period WITH &&)
  WHERE (status IN ('REQUESTED', 'CONFIRMED'));

-- ===========================================================================
-- 2. Row Level Security as a second line of defence (§3).
--    The app-layer guard is primary; this makes a missing WHERE clause unable
--    to leak another practice's clinical rows.
-- ===========================================================================

CREATE OR REPLACE FUNCTION current_doctor_id() RETURNS text
  LANGUAGE sql STABLE AS $$
    SELECT dp.id
    FROM "DoctorProfile" dp
    WHERE dp."userId" = current_setting('app.current_user_id', true)
$$;

CREATE OR REPLACE FUNCTION current_patient_id() RETURNS text
  LANGUAGE sql STABLE AS $$
    SELECT pp.id
    FROM "PatientProfile" pp
    WHERE pp."userId" = current_setting('app.current_user_id', true)
$$;

ALTER TABLE "ConsultationNote" ENABLE ROW LEVEL SECURITY;
CREATE POLICY note_doctor_access ON "ConsultationNote"
  USING (
    "linkId" IN (
      SELECT id FROM "PatientDoctorLink"
      WHERE "doctorId" = current_doctor_id()
    )
  );

ALTER TABLE "Document" ENABLE ROW LEVEL SECURITY;
CREATE POLICY document_access ON "Document"
  USING (
    "linkId" IN (
      SELECT id FROM "PatientDoctorLink"
      WHERE "doctorId" = current_doctor_id()
         OR "patientId" = current_patient_id()
    )
  );

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

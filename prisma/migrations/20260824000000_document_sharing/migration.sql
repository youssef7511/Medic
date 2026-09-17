-- Patient-initiated document sharing (Phase 4c).
-- Spec: docs/superpowers/specs/2026-08-24-document-sharing-design.md

-- CreateEnum
CREATE TYPE "ShareStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateTable
CREATE TABLE "DocumentShare" (
    "id"             TEXT           NOT NULL,
    "documentId"     TEXT           NOT NULL,
    "doctorId"       TEXT           NOT NULL,
    "sharedByUserId" TEXT           NOT NULL,
    "status"         "ShareStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt"      TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt"      TIMESTAMPTZ(3),

    CONSTRAINT "DocumentShare_pkey" PRIMARY KEY ("id")
);

-- Unique constraint: one share per (document, doctor) pair.
CREATE UNIQUE INDEX "DocumentShare_documentId_doctorId_key"
  ON "DocumentShare"("documentId", "doctorId");

-- Index for doctor-side queries: "show me all documents shared with me."
CREATE INDEX "DocumentShare_doctorId_status_idx"
  ON "DocumentShare"("doctorId", "status");

-- Foreign keys.
ALTER TABLE "DocumentShare"
  ADD CONSTRAINT "DocumentShare_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "Document"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DocumentShare"
  ADD CONSTRAINT "DocumentShare_doctorId_fkey"
  FOREIGN KEY ("doctorId") REFERENCES "DoctorProfile"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: extend document_access with share branch.
-- The existing policy allows doctor-of-link OR patient-of-link.
-- We add: OR (active share to current doctor).
ALTER POLICY document_access ON "Document"
  USING (
    "linkId" IN (
      SELECT id FROM "PatientDoctorLink"
      WHERE "doctorId" = current_doctor_id()
         OR "patientId" = current_patient_id()
    )
    OR "id" IN (
      SELECT "documentId" FROM "DocumentShare"
      WHERE "doctorId" = current_doctor_id()
        AND "status" = 'ACTIVE'
    )
  );

-- RLS: extend prescription_access with share branch (hop through Document).
ALTER POLICY prescription_access ON "Prescription"
  USING (
    "documentId" IN (
      SELECT d.id
      FROM "Document" d
      JOIN "PatientDoctorLink" l ON l.id = d."linkId"
      WHERE l."doctorId" = current_doctor_id()
         OR l."patientId" = current_patient_id()
    )
    OR "documentId" IN (
      SELECT ds."documentId" FROM "DocumentShare" ds
      WHERE ds."doctorId" = current_doctor_id()
        AND ds."status" = 'ACTIVE'
    )
  );

-- RLS on DocumentShare itself: the target doctor can see their own shares;
-- the owning patient can see shares they created (for the share indicator
-- on the document timeline).
ALTER TABLE "DocumentShare" ENABLE ROW LEVEL SECURITY;
CREATE POLICY document_share_access ON "DocumentShare"
  USING (
    "doctorId" = current_doctor_id()
    OR "documentId" IN (
      SELECT d.id FROM "Document" d
      JOIN "PatientDoctorLink" l ON l.id = d."linkId"
      WHERE l."patientId" = current_patient_id()
    )
  );

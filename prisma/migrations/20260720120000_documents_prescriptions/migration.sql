-- Documents & prescriptions (Phase 4b).
-- Spec: docs/superpowers/specs/2026-07-20-documents-prescriptions-design.md

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('ACTIVE', 'SUPERSEDED', 'REVOKED');

-- AlterTable: Document lifecycle + integrity fields.
-- byteSize is backfilled to 0 for any pre-existing rows (there are none in
-- practice — documents ship in this phase — then the default is dropped so the
-- application must always supply it.
ALTER TABLE "Document"
  ADD COLUMN "status"       "DocumentStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "contentType"  TEXT NOT NULL DEFAULT 'application/pdf',
  ADD COLUMN "byteSize"     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "revokedAt"    TIMESTAMPTZ(3),
  ADD COLUMN "revokedBy"    TEXT,
  ADD COLUMN "revokeReason" TEXT;

ALTER TABLE "Document" ALTER COLUMN "byteSize" DROP DEFAULT;

-- supersedesId becomes unique (linear version chain) + self-referencing FK.
CREATE UNIQUE INDEX "Document_supersedesId_key" ON "Document"("supersedesId");
ALTER TABLE "Document"
  ADD CONSTRAINT "Document_supersedesId_fkey"
  FOREIGN KEY ("supersedesId") REFERENCES "Document"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Replace the plain linkId index with (linkId, issuedAt) for the timeline.
DROP INDEX IF EXISTS "Document_linkId_idx";
CREATE INDEX "Document_linkId_issuedAt_idx" ON "Document"("linkId", "issuedAt");

-- CreateTable: Prescription (1:1 with Document).
CREATE TABLE "Prescription" (
    "id"                 TEXT           NOT NULL,
    "documentId"         TEXT           NOT NULL,
    "medicationsEnc"     BYTEA          NOT NULL,
    "notesEnc"           BYTEA,
    "allergySnapshotEnc" BYTEA          NOT NULL,
    "createdAt"          TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Prescription_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Prescription_documentId_key" ON "Prescription"("documentId");
ALTER TABLE "Prescription"
  ADD CONSTRAINT "Prescription_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "Document"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: Prescription is reachable by the treating doctor OR the owning patient,
-- one hop out through its Document → link. Mirrors the Document policy from
-- 20260719000000_hardening.
ALTER TABLE "Prescription" ENABLE ROW LEVEL SECURITY;
CREATE POLICY prescription_access ON "Prescription"
  USING (
    "documentId" IN (
      SELECT d.id
      FROM "Document" d
      JOIN "PatientDoctorLink" l ON l.id = d."linkId"
      WHERE l."doctorId" = current_doctor_id()
         OR l."patientId" = current_patient_id()
    )
  );

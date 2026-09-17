-- Consultation notes: revision history and retraction (Phase 4a).
-- Spec: docs/superpowers/specs/2026-07-19-consultation-notes-design.md

-- CreateEnum
CREATE TYPE "NoteStatus" AS ENUM ('ACTIVE', 'RETRACTED');
CREATE TYPE "RevisionReason" AS ENUM ('CREATE', 'EDIT', 'RETRACT');

-- AlterTable: note lifecycle
ALTER TABLE "ConsultationNote"
  ADD COLUMN "status"         "NoteStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "retractedAt"    TIMESTAMPTZ(3),
  ADD COLUMN "retractedBy"    TEXT,
  ADD COLUMN "retractReason"  TEXT,
  -- Backfill existing rows to "now" so the column can be NOT NULL, then drop
  -- the default: the application always supplies it explicitly.
  ADD COLUMN "lastRevisionAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "ConsultationNote" ALTER COLUMN "lastRevisionAt" DROP DEFAULT;

-- CreateTable: append-only revision history
CREATE TABLE "ConsultationNoteRevision" (
    "id"           TEXT             NOT NULL,
    "noteId"       TEXT             NOT NULL,
    "contentEnc"   BYTEA            NOT NULL,
    "authorUserId" TEXT             NOT NULL,
    "reason"       "RevisionReason" NOT NULL,
    "createdAt"    TIMESTAMPTZ(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsultationNoteRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
DROP INDEX IF EXISTS "ConsultationNote_linkId_idx";
CREATE INDEX "ConsultationNote_linkId_createdAt_idx" ON "ConsultationNote"("linkId", "createdAt");
CREATE INDEX "ConsultationNote_appointmentId_idx" ON "ConsultationNote"("appointmentId");
CREATE INDEX "ConsultationNoteRevision_noteId_createdAt_idx" ON "ConsultationNoteRevision"("noteId", "createdAt");

-- AddForeignKey
ALTER TABLE "ConsultationNoteRevision"
  ADD CONSTRAINT "ConsultationNoteRevision_noteId_fkey"
  FOREIGN KEY ("noteId") REFERENCES "ConsultationNote"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS for the revision table, mirroring the ConsultationNote policy one hop
-- further out through the note (§3).
ALTER TABLE "ConsultationNoteRevision" ENABLE ROW LEVEL SECURITY;

CREATE POLICY note_revision_doctor_access ON "ConsultationNoteRevision"
  USING (
    "noteId" IN (
      SELECT n.id
      FROM "ConsultationNote" n
      JOIN "PatientDoctorLink" l ON l.id = n."linkId"
      WHERE l."doctorId" = current_doctor_id()
    )
  );

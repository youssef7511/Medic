-- Phase 6 completion: enforce role scopes, persist doctor verification and
-- provide a controlled platform-settings singleton.

-- PostgreSQL treats NULL values as distinct inside a UNIQUE index. Remove any
-- accidental duplicate global assignments before replacing NULL with a stable
-- sentinel that Prisma can safely use in a compound unique upsert.
WITH ranked_global_roles AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "userId", "role"
      ORDER BY "grantedAt" DESC, "id" DESC
    ) AS occurrence
  FROM "RoleAssignment"
  WHERE "scopeId" IS NULL
)
DELETE FROM "RoleAssignment"
WHERE "id" IN (
  SELECT "id"
  FROM ranked_global_roles
  WHERE occurrence > 1
);

UPDATE "RoleAssignment"
SET "scopeId" = 'GLOBAL', "scopeType" = 'GLOBAL'
WHERE "scopeId" IS NULL;

ALTER TABLE "RoleAssignment"
  ALTER COLUMN "scopeId" SET DEFAULT 'GLOBAL',
  ALTER COLUMN "scopeId" SET NOT NULL;

ALTER TABLE "DoctorProfile"
  ADD COLUMN "licenseVerifiedAt" TIMESTAMPTZ(3),
  ADD COLUMN "licenseVerifiedById" TEXT;

-- Existing published profiles passed the previous manual process. Preserve
-- their public state while making all future publications enforce the gate.
UPDATE "DoctorProfile"
SET "licenseVerifiedAt" = "updatedAt"
WHERE "isPublished" = true;

ALTER TABLE "DoctorProfile"
  ADD CONSTRAINT "DoctorProfile_licenseVerifiedById_fkey"
  FOREIGN KEY ("licenseVerifiedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "DoctorProfile_licenseVerifiedAt_idx"
  ON "DoctorProfile"("licenseVerifiedAt");

CREATE TABLE "PlatformSettings" (
  "id" TEXT NOT NULL DEFAULT 'platform',
  "patientRegistrationEnabled" BOOLEAN NOT NULL DEFAULT true,
  "supportEmail" TEXT,
  "supportPhone" TEXT,
  "updatedByUserId" TEXT,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PlatformSettings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "PlatformSettings" ("id") VALUES ('platform');

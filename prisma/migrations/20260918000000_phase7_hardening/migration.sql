-- Phase 7: account lockout, hardened MFA enrollment and break-glass access.

ALTER TABLE "User"
  ADD COLUMN "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lockedUntil" TIMESTAMPTZ(3);

CREATE TABLE "MfaEnrollmentToken" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "usedAt" TIMESTAMPTZ(3),
  "revokedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MfaEnrollmentToken_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MfaEnrollmentToken_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MfaEnrollmentToken_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "MfaEnrollmentToken_tokenHash_key"
  ON "MfaEnrollmentToken"("tokenHash");
CREATE INDEX "MfaEnrollmentToken_userId_expiresAt_idx"
  ON "MfaEnrollmentToken"("userId", "expiresAt");

CREATE TYPE "BreakGlassStatus" AS ENUM ('ACTIVE', 'REVOKED');

CREATE TABLE "BreakGlassGrant" (
  "id" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "status" "BreakGlassStatus" NOT NULL DEFAULT 'ACTIVE',
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "revokedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BreakGlassGrant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BreakGlassGrant_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BreakGlassGrant_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "BreakGlassGrant_actorUserId_status_expiresAt_idx"
  ON "BreakGlassGrant"("actorUserId", "status", "expiresAt");
CREATE INDEX "BreakGlassGrant_patientId_createdAt_idx"
  ON "BreakGlassGrant"("patientId", "createdAt");

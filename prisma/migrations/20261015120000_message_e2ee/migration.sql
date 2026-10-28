ALTER TABLE "MessageThread" ADD COLUMN "subjectEnc" BYTEA;
ALTER TABLE "Message" ADD COLUMN "encryption" TEXT NOT NULL DEFAULT 'server-v1';
CREATE TABLE "MessagingIdentity" (
  "userId" TEXT NOT NULL,
  "publicKey" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MessagingIdentity_pkey" PRIMARY KEY ("userId"),
  CONSTRAINT "MessagingIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MessagingIdentity_fingerprint_key" ON "MessagingIdentity"("fingerprint");

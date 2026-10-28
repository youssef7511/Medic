-- Patient-upload metadata is encrypted; existing issued documents remain unchanged.
ALTER TABLE "Document" ADD COLUMN "uploadMetadataEnc" BYTEA;

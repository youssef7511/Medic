/**
 * Ensures the documents bucket exists. Idempotent; run after `db:storage`.
 * Reads STORAGE_* from .env.local.
 */
import { S3Client, CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';

async function main() {
  const endpoint = process.env.STORAGE_ENDPOINT;
  const bucket = process.env.STORAGE_BUCKET;
  if (!endpoint || !bucket) {
    throw new Error('STORAGE_ENDPOINT and STORAGE_BUCKET must be set (see .env.local).');
  }

  const client = new S3Client({
    endpoint,
    region: process.env.STORAGE_REGION ?? 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.STORAGE_ACCESS_KEY ?? '',
      secretAccessKey: process.env.STORAGE_SECRET_KEY ?? '',
    },
  });

  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    console.log(`Bucket "${bucket}" already exists.`);
    return;
  } catch {
    // fall through to create
  }

  await client.send(new CreateBucketCommand({ Bucket: bucket }));
  console.log(`Created bucket "${bucket}".`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});

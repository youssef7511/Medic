import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { ObjectNotFoundError, type ObjectStore, type StoredObject } from './types';

/**
 * S3-compatible object store. Targets MinIO in dev and any S3 provider in a
 * fixed jurisdiction in prod (§10). `forcePathStyle` is required for MinIO and
 * harmless elsewhere.
 */
export class S3ObjectStore implements ObjectStore {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: {
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
  }) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async get(key: string): Promise<StoredObject> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const body = await res.Body!.transformToByteArray();
      return { body, contentType: res.ContentType ?? 'application/octet-stream' };
    } catch (e) {
      if (
        e instanceof S3ServiceException &&
        (e.name === 'NoSuchKey' || e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404)
      ) {
        throw new ObjectNotFoundError(key);
      }
      throw e;
    }
  }

  async delete(key: string): Promise<void> {
    // S3 delete is idempotent — a missing key returns success.
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

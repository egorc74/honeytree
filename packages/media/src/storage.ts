import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/** `private`: originals and builds (presigned access only). `public`: processed media anyone can read. */
export type BucketName = 'private' | 'public';

export interface PresignedPut {
  url: string;
  headers: Record<string, string>;
}

export interface ObjectStorage {
  head(bucket: BucketName, key: string): Promise<{ size: number } | null>;
  /** Reads bytes `start..end` inclusive. */
  getRange(bucket: BucketName, key: string, start: number, end: number): Promise<Uint8Array>;
  downloadToFile(bucket: BucketName, key: string, path: string): Promise<void>;
  /** Streams the whole object, for example to the virus scanner. */
  openReadStream(bucket: BucketName, key: string): Promise<Readable>;
  putFile(
    bucket: BucketName,
    key: string,
    path: string,
    opts: { contentType: string; cacheControl?: string },
  ): Promise<void>;
  putBuffer(
    bucket: BucketName,
    key: string,
    body: Uint8Array,
    opts: { contentType: string; cacheControl?: string },
  ): Promise<void>;
  delete(bucket: BucketName, key: string): Promise<void>;
  deletePrefix(bucket: BucketName, prefix: string): Promise<void>;
  presignPut(
    bucket: BucketName,
    key: string,
    opts: { contentType: string; contentLength: number; expiresIn: number },
  ): Promise<PresignedPut>;
  presignGet(
    bucket: BucketName,
    key: string,
    opts: { expiresIn: number; downloadName?: string },
  ): Promise<string>;
  /** Absolute browser URL for a key in the public bucket. */
  publicUrl(key: string): string;
}

export interface S3StorageConfig {
  endpoint?: string;
  /** Endpoint used for URLs handed to browsers, when it differs from `endpoint`. */
  publicEndpoint?: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  bucketPrivate: string;
  bucketPublic: string;
  publicBaseUrl: string;
}

const attachmentName = (name: string) =>
  `attachment; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`;

export class S3Storage implements ObjectStorage {
  private readonly client: S3Client;
  /** Client whose endpoint is the one browsers can reach; only used to sign URLs. */
  private readonly signer: S3Client;

  constructor(private readonly config: S3StorageConfig) {
    const base = {
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      // The SDK adds CRC32 checksums by default, which presigned browser uploads cannot send,
      // and which R2 and older MinIO versions do not always accept.
      requestChecksumCalculation: 'WHEN_REQUIRED' as const,
      responseChecksumValidation: 'WHEN_REQUIRED' as const,
    };
    this.client = new S3Client({ ...base, endpoint: config.endpoint });
    this.signer = new S3Client({ ...base, endpoint: config.publicEndpoint ?? config.endpoint });
  }

  private bucketName(bucket: BucketName) {
    return bucket === 'private' ? this.config.bucketPrivate : this.config.bucketPublic;
  }

  async head(bucket: BucketName, key: string) {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucketName(bucket), Key: key }),
      );
      return { size: res.ContentLength ?? 0 };
    } catch (err) {
      const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404) return null;
      throw err;
    }
  }

  async getRange(bucket: BucketName, key: string, start: number, end: number) {
    const res = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucketName(bucket),
        Key: key,
        Range: `bytes=${start}-${end}`,
      }),
    );
    return res.Body!.transformToByteArray();
  }

  async downloadToFile(bucket: BucketName, key: string, path: string) {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucketName(bucket), Key: key }),
    );
    await pipeline(res.Body as Readable, createWriteStream(path));
  }

  async openReadStream(bucket: BucketName, key: string) {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucketName(bucket), Key: key }),
    );
    return res.Body as Readable;
  }

  async putFile(
    bucket: BucketName,
    key: string,
    path: string,
    opts: { contentType: string; cacheControl?: string },
  ) {
    const { size } = await import('node:fs/promises').then((fs) => fs.stat(path));
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucketName(bucket),
        Key: key,
        Body: createReadStream(path),
        ContentLength: size,
        ContentType: opts.contentType,
        CacheControl: opts.cacheControl,
      }),
    );
  }

  async putBuffer(
    bucket: BucketName,
    key: string,
    body: Uint8Array,
    opts: { contentType: string; cacheControl?: string },
  ) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucketName(bucket),
        Key: key,
        Body: body,
        ContentType: opts.contentType,
        CacheControl: opts.cacheControl,
      }),
    );
  }

  async delete(bucket: BucketName, key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucketName(bucket), Key: key }));
  }

  async deletePrefix(bucket: BucketName, prefix: string) {
    let token: string | undefined;
    do {
      const list = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucketName(bucket),
          Prefix: prefix,
          ContinuationToken: token,
        }),
      );
      const keys = (list.Contents ?? []).map((o) => ({ Key: o.Key! }));
      if (keys.length > 0) {
        await this.client.send(
          new DeleteObjectsCommand({
            Bucket: this.bucketName(bucket),
            Delete: { Objects: keys, Quiet: true },
          }),
        );
      }
      token = list.IsTruncated ? list.NextContinuationToken : undefined;
    } while (token);
  }

  async presignPut(
    bucket: BucketName,
    key: string,
    opts: { contentType: string; contentLength: number; expiresIn: number },
  ): Promise<PresignedPut> {
    const url = await getSignedUrl(
      this.signer,
      new PutObjectCommand({
        Bucket: this.bucketName(bucket),
        Key: key,
        ContentType: opts.contentType,
        ContentLength: opts.contentLength,
      }),
      {
        expiresIn: opts.expiresIn,
        // Signing content-length makes storage refuse a body of a different size.
        signableHeaders: new Set(['content-type', 'content-length']),
      },
    );
    // Browsers set Content-Length themselves; only Content-Type has to be sent explicitly.
    return { url, headers: { 'Content-Type': opts.contentType } };
  }

  presignGet(bucket: BucketName, key: string, opts: { expiresIn: number; downloadName?: string }) {
    return getSignedUrl(
      this.signer,
      new GetObjectCommand({
        Bucket: this.bucketName(bucket),
        Key: key,
        ResponseContentDisposition: opts.downloadName
          ? attachmentName(opts.downloadName)
          : undefined,
      }),
      { expiresIn: opts.expiresIn },
    );
  }

  publicUrl(key: string) {
    return `${this.config.publicBaseUrl.replace(/\/$/, '')}/${key}`;
  }
}

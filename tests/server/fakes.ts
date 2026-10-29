import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NoSuchKey,
  NotFound,
  type S3Client,
} from "@aws-sdk/client-s3";

// In-memory stand-ins for MinIO and pg-boss, installed for every tests/server/** test by
// setup.ts and emptied before each test. server/storage.ts runs for real down to the S3 client
// (signing, the `uploads` table), and only the network calls land here. server/jobs.ts is
// replaced: `enqueue` and `schedule` record calls instead of reaching pg-boss.

export type StoredObject = { bytes: Uint8Array; contentType: string };
export type EnqueuedJob = { name: string; payload: object; delaySeconds?: number; inTransaction: boolean };

/** The fake bucket, by key. */
export const objects = new Map<string, StoredObject>();
/** Every `enqueue` call, in order. A rolled-back transaction doesn't remove its jobs here. */
export const enqueuedJobs: EnqueuedJob[] = [];
/** Every `schedule` call: job name → cron. */
export const scheduledJobs = new Map<string, string>();

/** Stands in for the browser's PUT to a presigned upload URL. */
export function putTestObject(key: string, bytes: Uint8Array | string, contentType: string): void {
  objects.set(key, { bytes: typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes, contentType });
}

export function resetFakes(): void {
  objects.clear();
  enqueuedJobs.length = 0;
  scheduledJobs.clear();
}

/** Replacement for S3Client#send covering the commands server/storage.ts sends. */
export const fakeS3Send = (async (command: unknown) => {
  if (command instanceof HeadObjectCommand) {
    const object = objects.get(command.input.Key ?? "");
    if (!object) throw new NotFound({ message: "Not Found", $metadata: { httpStatusCode: 404 } });
    return { ContentLength: object.bytes.byteLength, ContentType: object.contentType };
  }
  if (command instanceof GetObjectCommand) {
    const object = objects.get(command.input.Key ?? "");
    // MinIO answers a missing key with NoSuchKey on GET (NotFound is HEAD's).
    if (!object) throw new NoSuchKey({ message: "The specified key does not exist.", $metadata: { httpStatusCode: 404 } });
    return { ContentType: object.contentType, Body: { transformToByteArray: async () => object.bytes } };
  }
  if (command instanceof DeleteObjectCommand) {
    objects.delete(command.input.Key ?? "");
    return {};
  }
  throw new Error(`fake S3: ${(command as object).constructor.name} isn't faked (tests/server/fakes.ts)`);
}) as S3Client["send"];

/** Replacement for @/server/jobs. */
export const fakeJobs = {
  boss: async () => {
    throw new Error("pg-boss isn't available in tests/server (tests/server/fakes.ts)");
  },
  enqueue: async (
    name: string,
    payload: object = {},
    { delaySeconds, tx }: { delaySeconds?: number; tx?: unknown } = {},
  ) => {
    enqueuedJobs.push({ name, payload, delaySeconds, inTransaction: tx !== undefined });
    return `fake-job-${enqueuedJobs.length}`;
  },
  schedule: async (name: string, cron: string) => {
    scheduledJobs.set(name, cron);
  },
  work: async () => {},
};

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { uploads } from "./db/schema";

// Videos and photos live in MinIO (§1.1.1). The browser PUTs to a presigned URL, the server
// saves the returned key (the `…StorageId` fields in server/db/schema.ts), and playback uses
// presigned GET URLs. The `uploads` table records who asked for each key.
//
// Two endpoints: S3_ENDPOINT is how the server reaches MinIO (http://minio:9000 inside compose),
// and S3_PUBLIC_URL is how a phone does (https://<domain>, which Caddy routes to MinIO). URLs
// are signed for the public one. Signing makes no network call.

const UPLOAD_TTL_SECONDS = 15 * 60;
// Download URLs are signed at the top of the hour and last two, so the same key gives the
// same URL for up to an hour. Feed polling then doesn't reload a playing <video> (§1.1.1).
const DOWNLOAD_WINDOW_MS = 60 * 60 * 1000;
const DOWNLOAD_TTL_SECONDS = 2 * 60 * 60;

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function bucket(): string {
  return env("S3_BUCKET");
}

function makeClient(endpoint: string): S3Client {
  return new S3Client({
    endpoint,
    region: process.env.S3_REGION || "us-east-1",
    forcePathStyle: true, // MinIO serves buckets as /<bucket>/<key>
    credentials: { accessKeyId: env("S3_ACCESS_KEY"), secretAccessKey: env("S3_SECRET_KEY") },
    // Without this the SDK signs a body checksum into presigned PUTs, which a browser upload
    // can't send.
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
}

let serverClient: S3Client | undefined;
let signingClient: S3Client | undefined;
const server = () => (serverClient ??= makeClient(env("S3_ENDPOINT")));
const signer = () => (signingClient ??= makeClient(process.env.S3_PUBLIC_URL || env("S3_ENDPOINT")));

/** Who is uploading: a resident or fixer by id, or an admin (seed, video intake). */
export type Uploader = { kind: "resident" | "fixer"; id: string } | { kind: "admin" };

/**
 * A new object key and a URL the browser PUTs the file to. The PUT must send this exact
 * Content-Type: it is signed, so the browser can't swap in another type. The caller must allow
 * only media types (video/*, image/*) here: MinIO is served from the app's origin, and Caddy's
 * `CSP: sandbox` + `nosniff` are the only other guard against an uploaded text/html. The key is
 * recorded as the uploader's in `uploads`.
 */
export async function createUploadUrl(
  contentType: string,
  uploader: Uploader,
): Promise<{ key: string; url: string }> {
  const key = crypto.randomUUID();
  const url = await getSignedUrl(
    signer(),
    new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: contentType }),
    { expiresIn: UPLOAD_TTL_SECONDS, signableHeaders: new Set(["content-type"]) },
  );
  await db.insert(uploads).values({
    key,
    uploaderKind: uploader.kind,
    uploaderId: uploader.kind === "admin" ? null : uploader.id,
    contentType,
    createdAt: Date.now(),
  });
  return { key, url };
}

/**
 * Whether this uploader asked for the key. Public URLs carry keys (§8), so check this before
 * saving a key from a request on a report or fix: anyone can copy someone else's key.
 */
export async function isUploadedBy(key: string, uploader: Uploader): Promise<boolean> {
  const [row] = await db.select().from(uploads).where(eq(uploads.key, key));
  if (!row || row.uploaderKind !== uploader.kind) return false;
  return uploader.kind === "admin" || row.uploaderId === uploader.id;
}

/** A URL that plays or downloads the object, stable for up to an hour. */
export async function getDownloadUrl(key: string, now = Date.now()): Promise<string> {
  const signingDate = new Date(now - (now % DOWNLOAD_WINDOW_MS));
  return getSignedUrl(signer(), new GetObjectCommand({ Bucket: bucket(), Key: key }), {
    expiresIn: DOWNLOAD_TTL_SECONDS,
    signingDate,
  });
}

/** The object's size and type, or null if there is no such key (M0's `db.system.get`). */
export async function statObject(key: string): Promise<{ size: number; contentType: string } | null> {
  try {
    const head = await server().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
    return { size: head.ContentLength ?? 0, contentType: head.ContentType ?? "" };
  } catch (error) {
    if (error instanceof NotFound || (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404)) {
      return null;
    }
    throw error;
  }
}

/**
 * The object's bytes, read over the server endpoint (M0's `ctx.storage.get`). For the
 * worker: inside compose a presigned URL points at Caddy's public address, which the worker
 * can't reach.
 */
export async function readObject(key: string): Promise<Uint8Array> {
  const object = await server().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  if (!object.Body) throw new Error(`Object ${key} has no body`);
  return object.Body.transformToByteArray();
}

/** Deletes the object and its `uploads` row. A key that doesn't exist is not an error. */
export async function deleteObject(key: string): Promise<void> {
  await server().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
  await db.delete(uploads).where(eq(uploads.key, key));
}

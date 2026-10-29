import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// The full GovTok schema (§2.1.1), ported from the M0 backend's schema (§1.1.1), plus `uploads`.
// US33 is the only card that edits this file or drizzle/, so the domain cards can run in parallel.
// Field names match the M0 schema so ported code reads the same; columns are snake_case in SQL.
// - `id` was `_id`, and `creationTime` was `_creationTime`.
// - `…StorageId` fields hold MinIO object keys (server/storage.ts).
// - Times are epoch milliseconds, as before.
// - Indexes the M0 code read as unique (`.unique()`) are unique here. Postgres doesn't serialize
//   check-then-insert the way M0 mutations were, so the index is what keeps them unique.

// Same lists as the routing table's CATEGORIES and OWNERS (§2.1.2; tests/server/schema.test.ts
// keeps them in sync).
export const categoryEnum = pgEnum("category", [
  "pothole",
  "signal_sign",
  "drainage",
  "water_leak",
  "streetlight",
  "trash_missed",
  "code_violation",
  "other",
]);
export const ownerEnum = pgEnum("owner", ["city", "cobb", "utility", "unknown"]);

export const mediaTypeEnum = pgEnum("media_type", ["video", "photos"]);
// §2.1.3
export const reportStatusEnum = pgEnum("report_status", ["pending", "held", "open", "fixed"]);
// §4.2.1
export const verdictEnum = pgEnum("verdict", ["pass", "mute", "retake", "emergency", "reject"]);
// §4.3.2
export const fixedByKindEnum = pgEnum("fixed_by_kind", ["fixer", "resident"]);
// §4.3.1
export const fixAttemptStatusEnum = pgEnum("fix_attempt_status", [
  "checking",
  "verified",
  "not_fixed",
  "retake",
  "failed",
  "superseded",
]);
export const videoIntakeStatusEnum = pgEnum("video_intake_status", [
  "uploaded",
  "transcribing",
  "complete",
  "failed",
]);

// Who asked for an upload URL (server/storage.ts). Admin uploads (seed, video intake) have no id.
export const uploaderKindEnum = pgEnum("uploader_kind", ["resident", "fixer", "admin"]);

// Transcript segment timestamps, in seconds (§1.1.4).
export type Segment = { start: number; end: number; text: string };

const id = () => uuid().primaryKey().defaultRandom();
const ms = () => bigint({ mode: "number" });
// clock_timestamp(), not now(): now() is the transaction's start, so rows inserted together
// would tie, and M0's _creationTime always moved forward.
const creationTime = () =>
  ms()
    .notNull()
    .default(sql`(extract(epoch from clock_timestamp()) * 1000)::bigint`);

export const residents = pgTable(
  "residents",
  {
    id: id(),
    creationTime: creationTime(),
    token: text().notNull(),
    createdAt: ms().notNull(),
  },
  (t) => [uniqueIndex("residents_by_token").on(t.token)],
);

export const fixers = pgTable(
  "fixers",
  {
    id: id(),
    creationTime: creationTime(),
    name: text().notNull(),
    org: text().notNull(),
    passcode: text().notNull(),
    token: text(), // issued when the passcode is checked (§3.1.2)
  },
  (t) => [uniqueIndex("fixers_by_passcode").on(t.passcode), uniqueIndex("fixers_by_token").on(t.token)],
);

export const reports = pgTable(
  "reports",
  {
    id: id(),
    creationTime: creationTime(),
    residentId: uuid()
      .notNull()
      .references(() => residents.id), // never public (§7.1.1)
    mediaType: mediaTypeEnum().notNull(),
    description: text(), // ≤280 characters (§4.1.1)
    clipStorageId: text(), // videos only
    frameStorageIds: text().array().notNull(), // ~6 frames for a video, or the 1–10 photos
    transcript: text(),
    segments: jsonb().$type<Segment[]>(),
    // The same segments translated to Spanish (§5.1.1). Null on reports from before US48.
    segmentsEs: jsonb().$type<Segment[]>(),
    lat: doublePrecision().notNull(),
    lng: doublePrecision().notNull(),
    street: text(),
    category: categoryEnum(),
    owner: ownerEnum(), // from ROUTING, never from the model (§2.1.2)
    agency: text(),
    title: text(),
    status: reportStatusEnum().notNull(),
    verdict: verdictEnum(),
    reason: text(),
    // "screening failed" holds (§4.2.1): the last error, shown to the poster for debugging,
    // and how many Try again taps are used (capped at MAX_SCREENING_RETRIES).
    screeningError: text(),
    screeningRetries: integer(),
    audioMuted: boolean().notNull(),
    isSample: boolean().notNull(),
    meTooCount: integer().notNull(),
    lastActivityAt: ms().notNull(),
    revealViews: integer().notNull(),
    createdAt: ms().notNull(), // explicit, so samples can be backdated (§6.1.1)
    fixStorageId: text(),
    fixedAt: ms(),
    fixedBy: uuid(), // a fixers or residents id, per fixedByKind; never public
    fixedByKind: fixedByKindEnum(),
    fixedByOrg: text(),
  },
  (t) => [
    index("reports_by_last_activity").on(t.lastActivityAt),
    index("reports_by_status_lat").on(t.status, t.lat),
    index("reports_by_resident").on(t.residentId),
    index("reports_by_status_created_at").on(t.status, t.createdAt),
  ],
);

export const meToos = pgTable(
  "me_toos",
  {
    id: id(),
    creationTime: creationTime(),
    reportId: uuid()
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    residentId: uuid()
      .notNull()
      .references(() => residents.id),
    createdAt: ms().notNull(),
  },
  (t) => [
    uniqueIndex("me_toos_by_report_resident").on(t.reportId, t.residentId),
    index("me_toos_by_resident").on(t.residentId),
  ],
);

// A fix waits here while the model checks it (§4.3.1).
export const fixAttempts = pgTable(
  "fix_attempts",
  {
    id: id(),
    creationTime: creationTime(),
    reportId: uuid()
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    byKind: fixedByKindEnum().notNull(),
    byId: uuid().notNull(), // a fixers or residents id, per byKind
    clipStorageId: text().notNull(),
    frameStorageIds: text().array().notNull(),
    lat: doublePrecision().notNull(),
    lng: doublePrecision().notNull(),
    status: fixAttemptStatusEnum().notNull(),
    reason: text(),
    createdAt: ms().notNull(),
  },
  (t) => [
    index("fix_attempts_by_report").on(t.reportId),
    index("fix_attempts_by_status_created_at").on(t.status, t.createdAt),
  ],
);

export const videoIntake = pgTable(
  "video_intake",
  {
    id: id(),
    creationTime: creationTime(),
    storageId: text().notNull(),
    fileName: text().notNull(),
    contentType: text().notNull(),
    fileSize: integer().notNull(),
    status: videoIntakeStatusEnum().notNull(),
    transcript: text(),
    segments: jsonb().$type<Segment[]>(),
    error: text(),
    createdAt: ms().notNull(),
    updatedAt: ms().notNull(),
  },
  (t) => [index("video_intake_by_created_at").on(t.createdAt)],
);

export const videoIntakeAdminSessions = pgTable(
  "video_intake_admin_sessions",
  {
    id: id(),
    creationTime: creationTime(),
    token: text().notNull(),
    expiresAt: ms().notNull(),
  },
  (t) => [
    uniqueIndex("video_intake_admin_sessions_by_token").on(t.token),
    index("video_intake_admin_sessions_by_expires_at").on(t.expiresAt),
  ],
);

// Every MinIO object and who uploaded it (§1.1.1, §8). Public URLs carry object keys, so a key
// alone proves nothing: before saving a key on a report or fix, check the caller uploaded it
// (server/storage.ts `isUploadedBy`). New in M1: M0 didn't record uploaders.
export const uploads = pgTable(
  "uploads",
  {
    key: text().primaryKey(),
    creationTime: creationTime(),
    uploaderKind: uploaderKindEnum().notNull(),
    uploaderId: uuid(), // a residents or fixers id, per uploaderKind; null for admin
    contentType: text().notNull(),
    createdAt: ms().notNull(),
  },
  (t) => [
    index("uploads_by_uploader").on(t.uploaderKind, t.uploaderId),
    index("uploads_by_created_at").on(t.createdAt), // purging uploads no report kept (§7.1.1)
  ],
);

export type Resident = typeof residents.$inferSelect;
export type Fixer = typeof fixers.$inferSelect;
export type Report = typeof reports.$inferSelect;
export type MeToo = typeof meToos.$inferSelect;
export type FixAttempt = typeof fixAttempts.$inferSelect;
export type VideoIntake = typeof videoIntake.$inferSelect;
export type VideoIntakeAdminSession = typeof videoIntakeAdminSessions.$inferSelect;
export type Upload = typeof uploads.$inferSelect;

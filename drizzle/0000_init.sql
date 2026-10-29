CREATE TYPE "public"."category" AS ENUM('pothole', 'signal_sign', 'drainage', 'water_leak', 'streetlight', 'trash_missed', 'code_violation', 'other');--> statement-breakpoint
CREATE TYPE "public"."fix_attempt_status" AS ENUM('checking', 'verified', 'not_fixed', 'retake', 'failed', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."fixed_by_kind" AS ENUM('fixer', 'resident');--> statement-breakpoint
CREATE TYPE "public"."media_type" AS ENUM('video', 'photos');--> statement-breakpoint
CREATE TYPE "public"."owner" AS ENUM('city', 'cobb', 'utility', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('pending', 'held', 'open', 'fixed');--> statement-breakpoint
CREATE TYPE "public"."uploader_kind" AS ENUM('resident', 'fixer', 'admin');--> statement-breakpoint
CREATE TYPE "public"."verdict" AS ENUM('pass', 'mute', 'retake', 'emergency', 'reject');--> statement-breakpoint
CREATE TYPE "public"."video_intake_status" AS ENUM('uploaded', 'transcribing', 'complete', 'failed');--> statement-breakpoint
CREATE TABLE "fix_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creation_time" bigint DEFAULT (extract(epoch from clock_timestamp()) * 1000)::bigint NOT NULL,
	"report_id" uuid NOT NULL,
	"by_kind" "fixed_by_kind" NOT NULL,
	"by_id" uuid NOT NULL,
	"clip_storage_id" text NOT NULL,
	"frame_storage_ids" text[] NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"status" "fix_attempt_status" NOT NULL,
	"reason" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fixers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creation_time" bigint DEFAULT (extract(epoch from clock_timestamp()) * 1000)::bigint NOT NULL,
	"name" text NOT NULL,
	"org" text NOT NULL,
	"passcode" text NOT NULL,
	"token" text
);
--> statement-breakpoint
CREATE TABLE "me_toos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creation_time" bigint DEFAULT (extract(epoch from clock_timestamp()) * 1000)::bigint NOT NULL,
	"report_id" uuid NOT NULL,
	"resident_id" uuid NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creation_time" bigint DEFAULT (extract(epoch from clock_timestamp()) * 1000)::bigint NOT NULL,
	"resident_id" uuid NOT NULL,
	"media_type" "media_type" NOT NULL,
	"description" text,
	"clip_storage_id" text,
	"frame_storage_ids" text[] NOT NULL,
	"transcript" text,
	"segments" jsonb,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"street" text,
	"category" "category",
	"owner" "owner",
	"agency" text,
	"title" text,
	"status" "report_status" NOT NULL,
	"verdict" "verdict",
	"reason" text,
	"screening_error" text,
	"screening_retries" integer,
	"audio_muted" boolean NOT NULL,
	"is_sample" boolean NOT NULL,
	"me_too_count" integer NOT NULL,
	"last_activity_at" bigint NOT NULL,
	"reveal_views" integer NOT NULL,
	"created_at" bigint NOT NULL,
	"fix_storage_id" text,
	"fixed_at" bigint,
	"fixed_by" uuid,
	"fixed_by_kind" "fixed_by_kind",
	"fixed_by_org" text
);
--> statement-breakpoint
CREATE TABLE "residents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creation_time" bigint DEFAULT (extract(epoch from clock_timestamp()) * 1000)::bigint NOT NULL,
	"token" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uploads" (
	"key" text PRIMARY KEY NOT NULL,
	"creation_time" bigint DEFAULT (extract(epoch from clock_timestamp()) * 1000)::bigint NOT NULL,
	"uploader_kind" "uploader_kind" NOT NULL,
	"uploader_id" uuid,
	"content_type" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_intake" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creation_time" bigint DEFAULT (extract(epoch from clock_timestamp()) * 1000)::bigint NOT NULL,
	"storage_id" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"file_size" integer NOT NULL,
	"status" "video_intake_status" NOT NULL,
	"transcript" text,
	"segments" jsonb,
	"error" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_intake_admin_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creation_time" bigint DEFAULT (extract(epoch from clock_timestamp()) * 1000)::bigint NOT NULL,
	"token" text NOT NULL,
	"expires_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fix_attempts" ADD CONSTRAINT "fix_attempts_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "me_toos" ADD CONSTRAINT "me_toos_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "me_toos" ADD CONSTRAINT "me_toos_resident_id_residents_id_fk" FOREIGN KEY ("resident_id") REFERENCES "public"."residents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_resident_id_residents_id_fk" FOREIGN KEY ("resident_id") REFERENCES "public"."residents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fix_attempts_by_report" ON "fix_attempts" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX "fix_attempts_by_status_created_at" ON "fix_attempts" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "fixers_by_passcode" ON "fixers" USING btree ("passcode");--> statement-breakpoint
CREATE UNIQUE INDEX "fixers_by_token" ON "fixers" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "me_toos_by_report_resident" ON "me_toos" USING btree ("report_id","resident_id");--> statement-breakpoint
CREATE INDEX "me_toos_by_resident" ON "me_toos" USING btree ("resident_id");--> statement-breakpoint
CREATE INDEX "reports_by_last_activity" ON "reports" USING btree ("last_activity_at");--> statement-breakpoint
CREATE INDEX "reports_by_status_lat" ON "reports" USING btree ("status","lat");--> statement-breakpoint
CREATE INDEX "reports_by_resident" ON "reports" USING btree ("resident_id");--> statement-breakpoint
CREATE INDEX "reports_by_status_created_at" ON "reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "residents_by_token" ON "residents" USING btree ("token");--> statement-breakpoint
CREATE INDEX "uploads_by_uploader" ON "uploads" USING btree ("uploader_kind","uploader_id");--> statement-breakpoint
CREATE INDEX "uploads_by_created_at" ON "uploads" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "video_intake_by_created_at" ON "video_intake" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "video_intake_admin_sessions_by_token" ON "video_intake_admin_sessions" USING btree ("token");--> statement-breakpoint
CREATE INDEX "video_intake_admin_sessions_by_expires_at" ON "video_intake_admin_sessions" USING btree ("expires_at");
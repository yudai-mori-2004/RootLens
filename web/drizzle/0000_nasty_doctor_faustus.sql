CREATE TABLE "clips" (
	"id" text PRIMARY KEY NOT NULL,
	"wallet_pubkey" text NOT NULL,
	"task_id" text NOT NULL,
	"state" text DEFAULT 'uploading' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"achievement_confidence" integer,
	"content_id" text,
	"signed_mp4_key" text,
	"dataset_prefix" text,
	"processing_step" text,
	"quality_score" integer,
	"quality_breakdown" jsonb,
	"idle_ratio" numeric(5, 4),
	"root_asset_id" text,
	"signed_json_uri" text,
	"delegate" text,
	"license_count" integer DEFAULT 0 NOT NULL,
	"revenue_usdc" numeric(18, 6) DEFAULT '0' NOT NULL,
	"error_message" text,
	"workflow_run_id" text
);
--> statement-breakpoint
CREATE TABLE "tos_consents" (
	"id" text PRIMARY KEY NOT NULL,
	"wallet_pubkey" text NOT NULL,
	"tos_version" text NOT NULL,
	"tos_hash" text NOT NULL,
	"consented_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE INDEX "clips_wallet_idx" ON "clips" USING btree ("wallet_pubkey");--> statement-breakpoint
CREATE INDEX "clips_state_idx" ON "clips" USING btree ("state");--> statement-breakpoint
CREATE INDEX "clips_content_id_idx" ON "clips" USING btree ("content_id");--> statement-breakpoint
CREATE INDEX "tos_consents_wallet_version_idx" ON "tos_consents" USING btree ("wallet_pubkey","tos_version");
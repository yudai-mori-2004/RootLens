CREATE TABLE "clips" (
	"id" text PRIMARY KEY NOT NULL,
	"wallet_pubkey" text NOT NULL,
	"signature_hash" text NOT NULL,
	"network" text DEFAULT 'devnet' NOT NULL,
	"state" text DEFAULT 'uploading' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processing_step" text,
	"error_message" text,
	"workflow_run_id" text,
	"recording_config" text NOT NULL,
	"duration_ms" integer,
	"content_size" bigint,
	"device_model" text,
	"root_asset_id" text NOT NULL,
	"signed_json_uri" text NOT NULL,
	"delegate" text,
	"quality_vector" jsonb,
	"summary" text,
	"license_count" integer DEFAULT 0 NOT NULL,
	"revenue_usdc" numeric(18, 6) DEFAULT '0' NOT NULL
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
CREATE INDEX "clips_signature_hash_idx" ON "clips" USING btree ("signature_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "clips_wallet_sig_network_uq" ON "clips" USING btree ("wallet_pubkey","signature_hash","network");--> statement-breakpoint
CREATE INDEX "tos_consents_wallet_version_idx" ON "tos_consents" USING btree ("wallet_pubkey","tos_version");
-- 同意イベントログ (= document/v0.1.3/legal/consent-log-spec/ja.md が正典)。
-- append-only: 同意・再同意・撤回のたびに 1 行追記。 UPDATE / DELETE はアプリからは行わない。
-- 層化同意の証跡として、 正本 (doc) と表示要約 (summary) の両方の版 + SHA-256 を残す。

CREATE TABLE "consent_events" (
  "id" text PRIMARY KEY NOT NULL,
  "event_type" text NOT NULL,
  "subject_pubkey" text NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "doc_slug" text NOT NULL,
  "doc_version" text NOT NULL,
  "doc_content_hash" text NOT NULL,
  "summary_version" text NOT NULL,
  "summary_hash" text NOT NULL,
  "scopes" jsonb NOT NULL,
  "checkbox_results" jsonb NOT NULL,
  "locale" text NOT NULL,
  "consent_method" text NOT NULL,
  "app_version" text,
  "device" text,
  "context" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "consent_events_subject_idx" ON "consent_events" ("subject_pubkey");
--> statement-breakpoint
CREATE INDEX "consent_events_occurred_idx" ON "consent_events" ("occurred_at");

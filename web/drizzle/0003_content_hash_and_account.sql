-- v0.1.4 task 12 (cleanup C2PA/TP/Solana remnants) の DB 側適用。
--
-- 1. clips.signature_hash → clips.content_hash に改名 (= 意味も変わる: 旧は C2PA D1 署名の
--    SHA-256、 新は raw mp4 バイト列の SHA-256)。
-- 2. clips.wallet_pubkey → clips.account_pubkey に改名 (Ed25519 pubkey、 Solana 由来ではない)。
-- 3. clips.network 列を撤去 (v0.1.5 の mint 予定廃棄で不要)。
-- 4. 重複排除 UNIQUE を (account_pubkey, content_hash) に縮小。
-- 5. tos_consents テーブルを撤去 (consent_events で置換済み、 0002_consent_events.sql 参照)。
--
-- 既存の R2 raw/<signature_hash>/... オブジェクトは orphan として R2 上に残置する
-- (= 中身が違う値を新 content_hash で再アップロードする流れ、 過去データは参照しない)。
-- 適用済み (production Supabase): 2026-07-10。
--
-- apply_one_migration.mjs は `--> statement-breakpoint` を境に分割して 1 文ずつ流すので、
-- 全体を単一 BEGIN/COMMIT で包まず、 各 DDL を個別 statement として置く。

ALTER TABLE "clips" RENAME COLUMN "signature_hash" TO "content_hash";
--> statement-breakpoint
ALTER TABLE "clips" RENAME COLUMN "wallet_pubkey" TO "account_pubkey";
--> statement-breakpoint
ALTER TABLE "clips" DROP COLUMN IF EXISTS "network";
--> statement-breakpoint
DROP INDEX IF EXISTS "clips_wallet_sig_network_uq";
--> statement-breakpoint
DROP INDEX IF EXISTS "clips_wallet_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "clips_signature_hash_idx";
--> statement-breakpoint
CREATE INDEX "clips_account_idx" ON "clips" USING btree ("account_pubkey");
--> statement-breakpoint
CREATE INDEX "clips_content_hash_idx" ON "clips" USING btree ("content_hash");
--> statement-breakpoint
CREATE UNIQUE INDEX "clips_account_content_uq" ON "clips" USING btree ("account_pubkey", "content_hash");
--> statement-breakpoint
DROP TABLE IF EXISTS "tos_consents";

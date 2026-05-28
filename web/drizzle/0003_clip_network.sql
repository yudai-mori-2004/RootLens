-- cNFT 発行ネットワーク (= devnet | mainnet) を clips に記録する。
-- 重複排除キーを (wallet_pubkey, signature_hash) から (wallet_pubkey, signature_hash, network) に拡張し、
-- devnet で発行済みの動画を後で mainnet で発行し直せるようにする。
-- 既存行はすべて devnet で発行済みなので DEFAULT 'devnet' で backfill する。
ALTER TABLE "clips" ADD COLUMN IF NOT EXISTS "network" text NOT NULL DEFAULT 'devnet';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clips_wallet_sig_network_idx" ON "clips" ("wallet_pubkey", "signature_hash", "network");

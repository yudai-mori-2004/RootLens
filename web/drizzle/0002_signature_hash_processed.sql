-- v0.1.3 仕様準拠リネーム (DATA_SPECS §1.1 / §5):
--   content_id   → signature_hash   (= C2PA D2 アクティブマニフェスト署名の SHA-256。 値は同一、 名前のみ)
--   dataset_prefix → processed_prefix (= Pipeline 2 / 3 の出力先 processed/<signature_hash>/)
-- 値は不変なので RENAME COLUMN でデータ保持したまま移行する。
ALTER TABLE "clips" RENAME COLUMN "content_id" TO "signature_hash";--> statement-breakpoint
ALTER TABLE "clips" RENAME COLUMN "dataset_prefix" TO "processed_prefix";--> statement-breakpoint
ALTER INDEX "clips_content_id_idx" RENAME TO "clips_signature_hash_idx";

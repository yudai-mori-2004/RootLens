-- v0.1.4 への移行: 「撮影アプリ = カメラ計測 + C2PA 署名 + raw アップロードの入口」に絞る。
-- 端末 blur / D2 / TP `/process` / cNFT mint / Pipeline 2 (採点 + ラベリング) / Pipeline 3 (WiLoR)
-- / staking を全部撤去するための schema 簡素化。
--
-- 詳細仕様は document/v0.1.4/DATA_SPECS_JA.md を参照。
-- 後段（blur / scoring / labeling / mint / staking）はサーバ別ワーカーとして v0.1.5 以降で再配線する想定。
-- その時は別テーブル / 別 schema に分離して clips 行に逆結合しない設計にする。

BEGIN;

-- ===== 1. 既存 state を v0.1.4 へ remap =====
-- v0.1.3 の processing / ready / staked は全部 uploaded として吸収する。
-- (= サーバ後段ワーカーが未配線なので、 これらの状態の意味が v0.1.4 では存在しない)
-- uploading / error はそのまま残す。
UPDATE "clips" SET "state" = 'uploaded' WHERE "state" IN ('processing', 'ready', 'staked');--> statement-breakpoint

-- ===== 2. 撤去する列 =====
ALTER TABLE "clips" DROP COLUMN IF EXISTS "root_asset_id";--> statement-breakpoint        -- cNFT mint 撤去
ALTER TABLE "clips" DROP COLUMN IF EXISTS "signed_json_uri";--> statement-breakpoint      -- TP /process 応答撤去
ALTER TABLE "clips" DROP COLUMN IF EXISTS "processing_step";--> statement-breakpoint      -- Pipeline 2 撤去
ALTER TABLE "clips" DROP COLUMN IF EXISTS "workflow_run_id";--> statement-breakpoint      -- WDK workflow 撤去
ALTER TABLE "clips" DROP COLUMN IF EXISTS "quality_vector";--> statement-breakpoint       -- 多軸採点撤去
ALTER TABLE "clips" DROP COLUMN IF EXISTS "summary";--> statement-breakpoint              -- ラベリング summary 撤去
ALTER TABLE "clips" DROP COLUMN IF EXISTS "delegate";--> statement-breakpoint             -- staking 撤去
ALTER TABLE "clips" DROP COLUMN IF EXISTS "license_count";--> statement-breakpoint        -- 販売撤去
ALTER TABLE "clips" DROP COLUMN IF EXISTS "revenue_usdc";--> statement-breakpoint         -- 販売撤去

-- ===== 3. 関連 index の整理 =====
-- state は uploading / uploaded / error の 3 値で低カーディナリティ。 index は要らない。
DROP INDEX IF EXISTS "clips_state_idx";--> statement-breakpoint

-- ===== 4. v0.1.4 で残す列 (= 参考) =====
-- id, wallet_pubkey, signature_hash (NOT NULL), network, state, created_at, updated_at,
-- recording_config, duration_ms, device_model, error_message
-- + 重複排除 lookup 用 index (clips_wallet_sig_network_idx, clips_signature_hash_idx, clips_wallet_idx)

COMMIT;

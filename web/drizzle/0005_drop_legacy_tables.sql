-- task 13: 過去フェーズの死骸テーブルを撤去する。
--
-- ⚠ 破壊操作。 実行前に必ず scripts/archive_legacy_tables.mjs でアーカイブ (backups/) を取ること。
--
--   cnft_assets          Solana cNFT (Title Protocol 時代、 1,489 行)
--   device_certificates  C2PA 端末証明書 CA (task 12 で機能ごと撤去済み、 374 行)
--   contents / pages / users  旧共有ページ機能 (wallet アドレス時代)
--
-- コード参照ゼロは 2026-07-12 に確認済み (web/db/schema.ts は clips + consent_events のみ)。

BEGIN;

DROP TABLE IF EXISTS cnft_assets;
DROP TABLE IF EXISTS device_certificates;
DROP TABLE IF EXISTS contents;   -- FK: contents.page_id → pages.id (先に消す)
DROP TABLE IF EXISTS pages;      -- FK: pages.user_id → users.id
DROP TABLE IF EXISTS users;

COMMIT;

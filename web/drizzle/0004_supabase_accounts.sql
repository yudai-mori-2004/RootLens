-- task 13: Supabase Auth アカウントへの移行 + clips の必要十分化。
--
-- 前提: scripts/create_account.mjs で以下を発行済み (2026-07-12):
--   developer_iphone_12      74ef1f9a-f25b-489f-89a7-5eb5efe8cc88  ← 旧鍵 ALi5Tkuf… (iPhone13,2 = iPhone 12)
--   developer_iphone_15_pro  936e39a7-6afb-418e-9b9a-b300258497df  ← 旧鍵 ACRiGYGB… (iPhone16,1 = iPhone 15 Pro)
--   bakery_01                5e195f17-6413-4b82-825d-da314fcb6a33  ← 新規現場 (既存行なし)
--
-- 旧時代の行 (5〜6月、 task 12 以前の旧識別子で R2 実体は orphan。 鍵 EetbEK2z… / EPZb94G1… /
-- 8jnPEbjt… の 36 本) は再生も納品もできない残骸のため削除する (2026-07-12 ユーザー判断)。
--
-- 内容:
--   - clips: PK を合成 id から content_hash へ (= R2 の raw/<content_hash>/ と 1:1)。
--     account_pubkey → account_id (uuid、 auth.users.id)。 v0.1.3 の亡霊カラム
--     (state / error_message / updated_at) を撤去し、 consent_event_id を追加。
--   - consent_events: subject_pubkey → account_id (uuid)。 SmokeTestAccount のテスト行は削除。

BEGIN;

-- ── 1. 旧時代の残骸行を削除 ──
DELETE FROM clips WHERE account_pubkey IN (
  'EetbEK2zEy4G5E148BJFcMHVs5MyzWCD6sDypyXBDbLu',
  'EPZb94G1EaJbDTVDNEoExSfVMb7ij74iLw818E3zXkrD',
  '8jnPEbjtgvDvM9moKofmS8wv3iy4rC5XDPXxfiSxUf6U'
);
DELETE FROM consent_events WHERE subject_pubkey = 'SmokeTestAccount111111111111111111111111111';

-- ── 2. content_hash 重複の整理 (= PK 化の前提。 同 hash は新しい行だけ残す) ──
DELETE FROM clips a
  USING clips b
  WHERE a.content_hash = b.content_hash
    AND (a.created_at < b.created_at
         OR (a.created_at = b.created_at AND a.id < b.id));

-- ── 3. account_id (uuid) + consent_event_id を追加して、 旧鍵 → アカウントへ backfill ──
ALTER TABLE clips ADD COLUMN account_id uuid;
UPDATE clips SET account_id = '74ef1f9a-f25b-489f-89a7-5eb5efe8cc88'
  WHERE account_pubkey = 'ALi5TkufAwbz5vkHHJmAk5RsZ854cPJif9qiKGZ4S1qx';
UPDATE clips SET account_id = '936e39a7-6afb-418e-9b9a-b300258497df'
  WHERE account_pubkey = 'ACRiGYGBRauAM7FPJc2AYY3XGY6Q85UWGCKiYVXXxGhe';
ALTER TABLE clips ALTER COLUMN account_id SET NOT NULL;  -- 取りこぼしがあればここで落ちる (= fail-loud)
ALTER TABLE clips ADD COLUMN consent_event_id text;

-- ── 4. PK を content_hash へ差し替え ──
ALTER TABLE clips DROP CONSTRAINT clips_pkey;
ALTER TABLE clips ADD CONSTRAINT clips_pkey PRIMARY KEY (content_hash);

-- ── 5. 亡霊カラムの撤去 (= 付随 index も列と共に消える) ──
ALTER TABLE clips DROP COLUMN id;
ALTER TABLE clips DROP COLUMN account_pubkey;   -- clips_account_idx / clips_account_content_uq も消える
ALTER TABLE clips DROP COLUMN state;
ALTER TABLE clips DROP COLUMN error_message;
ALTER TABLE clips DROP COLUMN updated_at;
DROP INDEX IF EXISTS clips_content_hash_idx;    -- PK と重複
CREATE INDEX clips_account_id_idx ON clips (account_id);

-- ── 6. consent_events: subject_pubkey → account_id ──
ALTER TABLE consent_events ADD COLUMN account_id uuid;
UPDATE consent_events SET account_id = '74ef1f9a-f25b-489f-89a7-5eb5efe8cc88'
  WHERE subject_pubkey = 'ALi5TkufAwbz5vkHHJmAk5RsZ854cPJif9qiKGZ4S1qx';
UPDATE consent_events SET account_id = '936e39a7-6afb-418e-9b9a-b300258497df'
  WHERE subject_pubkey = 'ACRiGYGBRauAM7FPJc2AYY3XGY6Q85UWGCKiYVXXxGhe';
ALTER TABLE consent_events ALTER COLUMN account_id SET NOT NULL;
ALTER TABLE consent_events DROP COLUMN subject_pubkey;  -- consent_events_subject_idx も消える
CREATE INDEX consent_events_account_idx ON consent_events (account_id);

COMMIT;

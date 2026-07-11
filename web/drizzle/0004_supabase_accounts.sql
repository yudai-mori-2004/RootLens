-- task 13: Supabase Auth アカウントへの移行 + clips の必要十分化。
--
-- 前提:
--   1. scripts/create_account.mjs で「自宅」アカウントを発行済みであること。
--   2. __HOME_ACCOUNT_UUID__ をその uuid に置換してから apply_one_migration.mjs で流すこと。
--
-- 内容:
--   - clips: PK を合成 id から content_hash へ (= R2 の raw/<content_hash>/ と 1:1)。
--     account_pubkey → account_id (uuid、 auth.users.id)。 v0.1.3 の亡霊カラム
--     (state / error_message / updated_at) を撤去し、 consent_event_id を追加。
--   - consent_events: subject_pubkey → account_id (uuid)。
--   - 既存行は全部「自宅」アカウントへ backfill (= これまでの撮影者は運営本人のみ)。

BEGIN;

-- ── 1. content_hash 重複の整理 (= PK 化の前提。 同 hash は新しい行だけ残す) ──
DELETE FROM clips a
  USING clips b
  WHERE a.content_hash = b.content_hash
    AND (a.created_at < b.created_at
         OR (a.created_at = b.created_at AND a.id < b.id));

-- ── 2. account_id (uuid) + consent_event_id を追加して backfill ──
ALTER TABLE clips ADD COLUMN account_id uuid;
UPDATE clips SET account_id = '__HOME_ACCOUNT_UUID__';
ALTER TABLE clips ALTER COLUMN account_id SET NOT NULL;
ALTER TABLE clips ADD COLUMN consent_event_id text;

-- ── 3. PK を content_hash へ差し替え ──
ALTER TABLE clips DROP CONSTRAINT clips_pkey;
ALTER TABLE clips ADD CONSTRAINT clips_pkey PRIMARY KEY (content_hash);

-- ── 4. 亡霊カラムの撤去 (= 付随 index も列と共に消える) ──
ALTER TABLE clips DROP COLUMN id;
ALTER TABLE clips DROP COLUMN account_pubkey;   -- clips_account_idx / clips_account_content_uq も消える
ALTER TABLE clips DROP COLUMN state;
ALTER TABLE clips DROP COLUMN error_message;
ALTER TABLE clips DROP COLUMN updated_at;
DROP INDEX IF EXISTS clips_content_hash_idx;    -- PK と重複
CREATE INDEX clips_account_id_idx ON clips (account_id);

-- ── 5. consent_events: subject_pubkey → account_id ──
ALTER TABLE consent_events ADD COLUMN account_id uuid;
UPDATE consent_events SET account_id = '__HOME_ACCOUNT_UUID__';
ALTER TABLE consent_events ALTER COLUMN account_id SET NOT NULL;
ALTER TABLE consent_events DROP COLUMN subject_pubkey;  -- consent_events_subject_idx も消える
CREATE INDEX consent_events_account_idx ON consent_events (account_id);

COMMIT;

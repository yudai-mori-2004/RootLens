-- 納品 manifest の domain / site の正を DB に持たせる。
--
-- 従来は納品パイプライン内の静的マップ (account_id → domain/site) で解決していたが、
-- 現場が増えるたびにコード 2 箇所を編集する運用は事故るので、 アカウント属性として管理する。
-- 置くのは "bakery-01" のような匿名コードのみ。 店名・契約・振込先などの実世界対応は
-- 引き続き DB に置かず、 運営の台帳で uuid ↔ 実世界を対応させる (= task 13 の
-- 店名非公表の構造的保証はそのまま)。
--
-- id は Supabase Auth の auth.users.id。 scripts/create_account.mjs で発行したら
-- ここに 1 行 INSERT する。 行が無いアカウント (テスト端末など) のクリップは
-- 納品パイプラインが GPU を回す前に拒否する (= developer_iphone_12 は意図的に行なし)。

BEGIN;

CREATE TABLE accounts (
  id uuid PRIMARY KEY,
  domain text NOT NULL,
  site text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO accounts (id, domain, site) VALUES
  ('936e39a7-6afb-418e-9b9a-b300258497df', 'home',   'home-01'),
  ('5e195f17-6413-4b82-825d-da314fcb6a33', 'bakery', 'bakery-01');

COMMIT;

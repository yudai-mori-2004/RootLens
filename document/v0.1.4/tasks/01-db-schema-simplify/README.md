# 01. DB schema 簡素化（v0.1.3 → v0.1.4）

## 目的

clips テーブルから v0.1.4 で撤去する列（mint / TP / Pipeline 2 / staking 関連）を削除し、 state machine を
3 値（`uploading / uploaded / error`）に縮小する。 `web/db/schema.ts` も v0.1.4 列定義に合わせる。

## 読むべきファイル

- `document/v0.1.4/DATA_SPECS_JA.md` §5（DB schema 差分一覧、 v0.1.4 の真実の列）
- `web/drizzle/0000_clips_init.sql`（baseline schema）
- `web/drizzle/0001_v0_1_4_simplify.sql`（このタスクで適用する migration、 既に作成済み）
- `web/db/schema.ts`（drizzle 型定義、 SQL と 1:1 で同期させる）
- `web/scripts/apply_migrations.mjs`（適用スクリプト、 idempotent ではないので 0001 だけ単独で流す）

## スコープ

### やること

1. `0001_v0_1_4_simplify.sql` を Supabase に**手動で**適用（apply_migrations.mjs は 0000 から流すと
   table 既存で死ぬ。 0001 の内容を直接 psql / Supabase SQL Editor で流す）。
2. `web/db/schema.ts` の clips から以下を削除:
   `rootAssetId` / `signedJsonUri` / `processingStep` / `workflowRunId` / `qualityVector` /
   `summary` / `delegate` / `licenseCount` / `revenueUsdc`。
3. `clips_state_idx` 定義を削除（SQL 側でも DROP 済み）。
4. tsc green を確認。

### やらないこと

- `clips` テーブルの DROP / TRUNCATE。 既存 devnet データはそのまま「uploaded」 として吸収。
- 別テーブル（tos_consents 等）の変更。
- v0.1.5 で復活させる「後段ワーカー用の processed_xxx テーブル」 の事前作成 (= 別タスク)。

## 成功基準

- `0001_v0_1_4_simplify.sql` が本番 DB に適用済み。
- `web/db/schema.ts` の clips が SQL と一致。 `npx tsc --noEmit`（web）green。
- 既存行の state が uploading / uploaded / error のみ。
- 削除した列 (root_asset_id 等) を参照しているコードが無い（02・03 の前提）。

## 進捗

- [x] `0001_v0_1_4_simplify.sql` 作成
- [x] migration 本番適用（2026-07-04、 `node scripts/apply_migrations.mjs 0001_v0_1_4_simplify.sql`。
      58 行すべて state='uploaded' に remap、 削除列なし、 index は pkey + wallet + signature_hash
      + wallet_sig_network の 4 本を実測確認）
- [x] `web/db/schema.ts` 更新（v0.1.4 列のみ + clips_state_idx 撤去）
- [x] tsc green 確認

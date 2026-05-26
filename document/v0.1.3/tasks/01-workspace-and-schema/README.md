# タスク 01: ワークスペース構築 + DB schema + 共通型

## 目的

v0.1.3 server の骨格を 0 から立ち上げ、 全後続 task の前提となる DB schema と共通型を確定する。 v0.1.2 (= `server/` 配下) は legacy として手付かずで残す。

## 読むべきファイル

1. `document/v0.1.3/DATA_SPECS_JA.md` ─ 全文。 特に:
   - §1.1 content_id の定義 (= C2PA D2 active manifest signature の SHA-256)
   - §3.2 4 層スコアリング (= qualityBreakdown 型の根拠)
   - §5.1 R2 バケット構成 (= 2 バケットに簡素化)
   - §6 クリップ状態機械
2. `server/db/schema.ts`、 `server/shared/api-types.ts`、 `server/lib/r2-keys.ts`、 `server/lib/r2.ts`、 `server/lib/auth.ts` ─ v0.1.2 の同類ファイル。 差分箇所を把握
3. `server/package.json`、 `server/tsconfig.json`、 `server/next.config.ts`、 `server/drizzle.config.ts` ─ そのまま流用 + Neon → Supabase 差し替え

## スコープ

### やること

1. **ディレクトリ構造の作成** (= `v0.1.3/server/{app/api/clips/[id]/{finalize,retry,stake},lib,workflow,modal,db,shared,scripts/mock_device,drizzle}`)
2. **Next.js 設定一式** (= `package.json` / `tsconfig.json` / `next.config.ts` / `drizzle.config.ts` / `.env.example` / `.gitignore`)
3. **共通型** (= `shared/api-types.ts`):
   - `ClipState`、 `ProcessingStep` (= 5 ステップに刷新)
   - `Layer1Score` / `Layer2Score` / `Layer3Score` / `GtsamScore` / `QualityBreakdown` (= 仕様 §3.2 の 4 層 + 全 sub-metric)
   - `ClipDto` (= contentId、 signedMp4Key、 idleRatio、 signedJsonUri 等の v0.1.3 フィールド)
   - 各 REST API のリクエスト / レスポンス型
4. **DB schema** (= `db/schema.ts`):
   - `clips` テーブル (= contentId、 signedMp4Key (旧 rawMp4Key + blurredMp4Key を統合)、 qualityBreakdown jsonb (= QualityBreakdown 型)、 signedJsonUri、 idleRatio、 datasetPrefix 等)
   - `tos_consents` テーブル (= v0.1.2 と同形)
5. **DB client** (= `db/client.ts`):
   - Neon HTTP driver から `postgres` (= postgres-js) + `drizzle-orm/postgres-js` に差し替え
   - Supabase Transaction Pooler を前提に `prepare: false`
6. **R2 アクセス** (= `lib/r2-keys.ts` + `lib/r2.ts`):
   - `BUCKET_BLURRED` と関連 presign 関数を完全削除
   - `rawSessionPrefix` / `signedMp4Key` / `depthFrameKey` / `datasetPrefix` を仕様に整合
   - `presignRawSessionUploads` / `presignSignedMp4Get` / `presignDatasetGet` のみに整理
7. **認証** (= `lib/auth.ts`): v0.1.2 から無修正でポート

### やらないこと

- API route の中身 (= task 03)
- WDK workflow の中身 (= task 03 + 04-08)
- Modal 関数 (= task 04-09)
- Pipeline 1 mock CLI (= task 02)
- iOS アプリ実装 (= 後続フェーズ)
- License NFT / 収益分配 (= v0.1.2 で実装済)

## 成功基準

- [x] `v0.1.3/server/` のディレクトリツリーが揃う
- [x] `package.json` が postgres-js 経由 (= Neon ではなく Supabase) で構築されている
- [x] `db/schema.ts` の `clips` テーブルが contentId / signedMp4Key / 4 層 qualityBreakdown / signedJsonUri / idleRatio / datasetPrefix を保持
- [x] `shared/api-types.ts` で 4 層スコアの型と新 `ProcessingStep` enum が公開されている
- [x] `lib/r2.ts` の R2 バケット環境変数が `R2_BUCKET_RAW` + `R2_BUCKET_DATASETS` の 2 つに整理されている
- [x] `lib/auth.ts` が v0.1.2 と完全一致 (= 形式チェックのみ、 challenge-response は MVP 後)
- [ ] `.env.example` に全環境変数のテンプレートが揃っている (= DATABASE_URL / R2_* / MODAL_*_ENDPOINT / TP_NETWORK / ROOTLENS_TOS_* / ANTHROPIC_API_KEY 等)
- [ ] `npm install` が通る (= package.json + lockfile が整合)
- [ ] `npm run typecheck` が通る (= 型エラーゼロ)
- [ ] `npm run db:generate` が通り、 `drizzle/` に SQL migration が生成される

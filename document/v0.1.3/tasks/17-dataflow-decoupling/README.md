# タスク 17: dataflow / UI 疎結合 + 仕様準拠フルスタック移行 + C2PA 検証成立

## 目的

app/ で UI ロジックとデータフローが密結合し、データフロー単独で触れず不安定化していた。これを 3 層に分離し、UI から独立した開発者用サンドボックスでデータフローを駆動できるようにする。その過程で全層 (app / native / web / modal / mock-device) を `DATA_SPECS_JA.md` の用語・構造へ揃え、長らく失敗し続けていた C2PA 来歴検証を成立させる。

## 読むべきファイル

- `document/v0.1.3/DATA_SPECS_JA.md` (§1 識別子, §2.2 撮影構成, §3 Pipeline 2, §4 Pipeline 3, §5 ストレージ) — Source of Truth
- `app/src/dataflow/` — 新データ層 (Layer 1)
- `app/src/devsandbox/DevSandboxScreen.tsx` — 開発者サンドボックス (Layer 3)
- `app/scripts/check-dataflow-purity.mjs` — Layer 1 の純粋性ガード
- `native/c2pa-bridge/src/pipeline1.rs` / `tools/mock-device/src/c2pa_sign.rs` — C2PA 署名 (D1/D2)

## スコープ

### やったこと

**1. dataflow / UI 3 層分離 + DevSandbox**
- Layer 1 `app/src/dataflow/`: 純粋データ層 (react/react-native/zustand を import 禁止、`npm run check:dataflow` で機械強制)。`steps/` (sign / upload / titleProtocol / register / pipeline2 / pipeline3) は単独実行可能な純粋関数 + `EventSink` で進捗を吐く。`orchestrator.ts` が Pipeline 1 を連結。`recording-configs/` は撮影構成の抽象 interface (ultra_wide = iOS/Android 共通、arkit = iOS 限定スタブ) を platform 別レジストリで持つ。`store.ts` は zustand/vanilla。
- Layer 3 `app/src/devsandbox/DevSandboxScreen.tsx`: `__DEV__` 時に `App.tsx` が RootNavigator の代わりに起動 (`USE_DEV_SANDBOX`)。録画→Pipeline 1→2→3 を 1 ボタンずつ叩き、EventSink ログを画面表示。
- 既存 `services/pipeline1.ts` / `clipPipeline.ts` + 本番 screens は残し並走 (本番 UI の dataflow 層移行は Phase C = 別タスク)。

**2. signature_hash + processed フルスタック移行** (DATA_SPECS §1.1 / §5)
- `content_id` → `signature_hash` (変数 / DB 列 / ワイヤ / R2 キー。値は同一)。DB は `web/drizzle/0002_signature_hash_processed.sql` で RENAME COLUMN (適用済み)。
- ファイル名: `frames.jsonl` → `realtime_handpose.jsonl`、`camera_intrinsics.json` → `metadata.json` (機種 / OS / アプリ版 / カメラ画角・解像度 / 構成 ID 等の静的情報。native wide-capture が録画開始時に書く)。
- バケット: `rootlens-datasets` → `rootlens-processed`、prefix `datasets/<root_asset_id>/` → `processed/<signature_hash>/`。env も `R2_BUCKET_PROCESSED` / `MODAL_WILOR_ENDPOINT` に。
- Pipeline 3 再定義: `tools/modal/bundle.py` (LeRobot 構築) を廃止し `tools/modal/wilor.py` (WiLoR → `processed/<signature_hash>/wilor.jsonl` のみ) に。Modal app `rootlens-bundle` → `rootlens-wilor`。GTSAM 層は完全撤去 (3 層スコアリング)。
- Pipeline 2 は `processed/<signature_hash>/` に `semantic.jsonl` + `quality_scores.json` を書く (layer3_vlm)。データセット化はパイプライン外。

**3. VLM ラベリング: 10s 密度 + dense narration** (DATA_SPECS §3.2.3)
- `vlm_interval_sec` 30 → 10 (= Ego4D の dense narration 〜10s と同等密度、約 $1.2/時)。
- 主ラベルを「具体的・多様な行動記述文 (verb+noun)」に。固定 8 カテゴリは marketplace フィルタ用の粗い派生ビューに降格 (taxonomy は固定せず、記述文の embedding から事後導出可能)。

**4. C2PA 来歴検証の成立** (DATA_SPECS §2.4)
- 真因は 2 つの独立した問題:
  1. D2 actions が `c2pa.placed` 単体 → C2PA 2.x 違反 (先頭 action は created/opened、placed は ingredient param 必須)。修正: blur action を `c2pa.edited` に、`builder.set_intent(c2pa::BuilderIntent::Edit)` で Builder が parentOf ingredient 付き `c2pa.opened` を自動前置。
  2. 署名 cert の Subject DN に Organization (`O=`) が無い → c2pa-rs が `MissingSigningCertificateChain` を返し、それが `claimSignature.mismatch` という紛らわしいコードで表面化。修正: dev cert (EE+CA) を `O=RootLens` 付きで再発行 (`ee.key` 流用) し、`native/c2pa-bridge/fixtures/` と `tools/mock-device/fixtures/` の `chain.pem` を差し替え。
- 検証: mock-device dev 署名 → c2pa 0.84.1 reader (trust-off) = **Valid**、TP gateway `/process` = **c2pa-verify status: ok**。これまで全クリップで Invalid だった来歴検証が end-to-end で初めて成立 (パイプラインが gate していなかったため気付かれていなかった)。

### やらないこと

- 本番 UI screens (`CollectionScreen` / `CalibrationCaptureScreen` 等) を dataflow 層へ向け直す移行 (= Phase C)。今は旧 `services/` と並走。
- 複数クリップのデータセット化 (LeRobot v3 等) — パイプライン外、事後集計。
- Secure Enclave P-256 / ES256 による本番 C2PA 署名の配線。現状は bundled dev fixture (Ed25519, O= 修正済) を使用。SE 署名に切替える時は端末側 CSR 生成 (`certs/dev/issue-device-cert.sh` 経路) の DN にも `O=` を入れること (= 同じ罠)。
- Pipeline 3 を端末 / web から自動起動する endpoint。仕様通り手動 ops (Modal 直叩き)。DevSandbox のボタンは規約的 endpoint を叩き、未実装の間は明示。

## 成功基準

- [x] DevSandbox が実機で起動し、録画→Pipeline 1→2 が完走 (state=ready、品質スコア取得)
- [x] R2 storage が DATA_SPECS §5 通り (raw: rgb.mp4 + realtime_handpose.jsonl + metadata.json + signed-json、processed: quality_scores.json + semantic.jsonl + wilor.jsonl)。実ファイル解析でスキーマ一致を確認
- [x] DB が signature_hash / processed_prefix で整合
- [x] C2PA 検証が TP `/process` で status: ok
- [ ] **実機ビルドで C2PA 修正を反映** (c2pa-bridge の iOS .a 再ビルド → アプリ再ビルド → 実機再録画で TP ok 確認) ← 進行中
- [ ] `dataflow purity` / `tsc` (app + web) / `py_compile` / `cargo check` 全層クリーン (移行起因エラー 0、既存の `CalibrationCaptureScreen.tsx` の `announcedRef` 未定義は別タスク)

## 進捗

- dataflow 3 層分離 + DevSandbox: **完了**。実機 (森雄大's iPhone, iOS 26.4.2) で起動 + Pipeline 1→2 完走を確認。
- フルスタック移行 (app/native/web/modal/mock-device): **完了**。web は main に push 済 (Vercel)、Modal は layer1-3 更新 + wilor 新規 deploy + 旧 app 停止、DB migration 0002 適用済。
- VLM 10s + dense prompt: **完了** (deploy + push 済)。実証は数分尺の活動クリップを実機録画して semantic.jsonl を解析するのが残課題。
- C2PA 修正: **ソース完了 + TP で検証済** (commit `dcf8f82`, push は実機テスト後)。c2pa-bridge の iOS .a (device/sim) 再ビルド → アプリ再ビルド → 実機録画で最終確認、が残り。

## 関連メモ

- 検証スクリプト: `web/scripts/r2_inspect.mjs` (R2 一覧/取得)、`web/scripts/apply_one_migration.mjs` (増分 migration)、mock-device `--verify-only` / `--selftest` (C2PA ローカル検証)。
- 検証済みクリップ例: `signature_hash=ff83ebef…e8049` (実機, score 41/100, processed 全ファイル + wilor.jsonl 生成済)。

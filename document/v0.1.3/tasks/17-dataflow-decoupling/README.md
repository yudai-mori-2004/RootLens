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

## 追加スコープ (2026-05-28 合意、未着手 — 長尺実測の後に実装)

### A. blur 領域メタデータを C2PA に埋め込む (新ファイル無し) ✅ 実装済み (2026-05-28)
- 目的: 「何を・どのフレームのどこを除去したか」を来歴に残す (= 買い手の透明性 / blur 領域 mask / 監査)。
- 形式: 別ファイルは作らず、D2 マニフェストにカスタム assertion `io.rootlens.privacy.blur.v1` として per-frame の顔 bbox を載せる → 署名されて tamper-evident。data: `{operation, detector, method, coordinate_space:"normalized_top_left", total_faces_blurred, frames:[{frame_index, regions:[{x,y,w,h}]}]}`。座標は upright フレームの top-left 原点・正規化 [0,1]、顔が映ったフレームのみ。
- サイズ: 典型 (顔は断続的) で数十〜数百 KB、顔が映り続ける長尺で最大 ~1-2MB。C2PA 埋め込みで問題ないレンジ。
- 実装した連鎖:
  - `PrivacyBlurProcessor.swift`: ぼかした smoothed+inflated 領域を per-frame 収集 → `PrivacyBlurResult.blurRegions` で返す (top-left 正規化, 4 桁丸め)。
  - `app/src/units/privacy-blur/index.ts`: `blurRegions: BlurFrameRegions[]` を追加。
  - `app/src/dataflow/steps/sign.ts`: assertion data を組立 → `signD2(..., blurAssertionJson)`。
  - `native/c2pa-bridge/src/pipeline1.rs`: `pipeline1_sign_d2` に `blur_assertion_json` 引数追加、`build_d2_manifest` が assertion を append (best-effort、parse 失敗で署名は止めない)。
  - `c2pa_bridge.h` / `C2paBridgeModule.swift` / `c2paBridge.ts`: FFI/ブリッジ/wrapper に引数追加。
  - 検証: cargo check (host) OK / app tsc 移行起因エラー 0。**実機反映には c2pa-bridge .a 再ビルド + privacy-blur/c2pa-bridge pod 再ビルド (= アプリ再ビルド) が必要**。DATA_SPECS §2.3 に記載。

### C. Pipeline 1 の background 化 + resumable キュー (本番撮影フロー、大きめ — 独立タスク化も可)
- 現状: 撮影後の端末処理 (blur / D1+D2 sign / signature_hash / R2 upload / TP /process / cNFT mint / POST /api/clips) は **全て foreground** で走る。upload も `expo-file-system uploadAsync` = foreground (DATA_SPECS §2.5 の Background URLSession は未実装)。アプリが background に入ると JS が suspend し、処理が止まる/消える。
- iOS 制約 (期待値): background で任意の処理を即時実行はできない。`beginBackgroundTask` は数分、`BGProcessingTask` は OS が時間を決める (遅延あり)、`Background URLSession` だけがアップロードを suspend/kill 跨ぎで継続する。→ 達成目標は「**永続 + resumable で データ喪失ゼロ、 アップロードは background 継続、 重い計算は active 時 or OS 許諾時に再開して最終的に完走**」(「放置で全部即完了」ではない)。
- アーキ:
  1. 永続 resumable キュー (クリップごとの step state: recorded→blurred→signed→uploaded→tp→minted→registered)。
  2. Background URLSession で R2 upload (= native module 追加 or react-native-background-upload 系) + `UIBackgroundModes` 宣言。
  3. `BGProcessingTask` で blur/sign + upload 後のネットワーク工程をドレイン。
  4. `beginBackgroundTask` で短時間離脱中の blur 即 kill を回避。
  5. 各 step 冪等 (signature_hash 重複排除 + POST /api/clips 冪等は既存)。
- B (blur 堅牢化) はこの C に吸収される。対象は本番撮影画面で、DevSandbox は対象外。

#### 実機実測 (2026-05-28, iPhone 12 = iPhone13,2)
- **blur は約 0.5x リアルタイム**: 1 時間動画で blur に **~30 分**。発熱は軽度 (撮影と重なるため切り分け未)。
- **TP /process は完全サーバー側** (R2 起点で TEE が fetch): 2GB 動画でも **2〜3 分**。端末は HTTP を呼んで待つだけ、計算負荷ゼロ。

#### 設計の確定点
- 「端末が重い」のは **blur + sign + upload まで**。TP /process 以降 (TP・cNFT mint・POST /api/clips) はサーバー/ネットワークで、端末は待つだけ。→ background で守るべき device 計算は実質 **blur + sign**。
- 30 分級の blur は **pure background では回せない** (BGProcessingTask は OS が時間を決める)。長尺を「放置で必ず完走」させるには **blur を resumable (フレーム checkpoint → 再開)** にし、foreground + BG window をまたいで進捗を積む。← C で最も重い実装。
- ただし UI_SPECS §2.2 のヘッドマウント運用は **複数の短いクリップ連続撮影**が前提 (60 分は安全上限)。典型 5-10 分なら blur 2.5-5 分で foreground + beginBackgroundTask 猶予で捌ける。resumable キューは長尺/短尺どちらも吸収。

#### 実装順序 (確定)
1. **Background URLSession で R2 upload** + `UIBackgroundModes` (= 一番確実に background 継続する部分)。
2. **永続 resumable キュー** (step state 保存、 アプリ再起動/BG window 跨ぎで再開)。
3. **blur を resumable 化** (フレーム checkpoint) + beginBackgroundTask 猶予 + BGProcessingTask でドレイン。
4. TP/mint/register は upload 完了後にキューが順次叩く (端末は待つだけなので軽い)。

### B. 長尺 blur の堅牢化 (まず実測 → 必要分だけ。 C に吸収)
- 現状の `PrivacyBlurProcessor` は **AVAssetReader/Writer のストリーミング + フレームごと autoreleasepool** なので、長尺でも OOM しない設計。メモリ起因クラッシュは手当て済み。
- 残る実リスクと対策:
  - **iOS による kill**: blur 中にアプリを離れるとサスペンド/終了で処理が消える → `beginBackgroundTask` / BGProcessingTask で完走保証 (最優先)。
  - **時間**: iPhone 12 で 30 分クリップの blur が 15〜25 分かかり得る → DevSandbox に進捗表示 (`onProgress` は実装済み) + キャンセル。
  - **発熱**: iOS が自動スロットリング (= 遅くなるだけ)。任意で `ProcessInfo.thermalState == .critical` 時にペース調整。
- 方針: **先に実機長尺で blur 所要時間 / thermalState を実測**し、数字を見てから background task + 必要なら throttle を足す (= 過剰設計回避)。

## 関連メモ

- 検証スクリプト: `web/scripts/r2_inspect.mjs` (R2 一覧/取得)、`web/scripts/apply_one_migration.mjs` (増分 migration)、mock-device `--verify-only` / `--selftest` (C2PA ローカル検証)。
- 検証済みクリップ例: `signature_hash=ff83ebef…e8049` (実機, score 41/100, processed 全ファイル + wilor.jsonl 生成済)。

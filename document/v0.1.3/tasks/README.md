# RootLens v0.1.3 タスク一覧

データパイプラインを CUI レベルで end-to-end 通すまでの実装単位。 各 task は独立した PR / 実装ユニットとして扱う。

## 全体マップ

```
Phase A (基盤)
  01. workspace-and-schema           web/ の骨格と DB schema

Phase B (Pipeline 1: 端末模擬)
  02. pipeline-1-mock-cli             Rust CLI で raw MP4 → 2 段 C2PA + 顔ぼかし + R2 アップロード + TP /process + cNFT 発行

Phase C (Pipeline 2: サーバ自動)
  03. pipeline-2-server-skeleton      API endpoints (= rootAssetId 必須) + WDK workflow 骨格 (= 4 step) + lib/mapper
  04. pipeline-2-layer-1-metadata     第 1 層 (sensors.jsonl + imu_high_rate.jsonl で 20 点)
  05. pipeline-2-layer-2-frame-sampling 第 2 層 (フレームサンプル画像解析で 15 点)
  06. pipeline-2-layer-3-vlm          第 3 層 (Claude Haiku 4.5 で 55 点)
  07. pipeline-2-gtsam                Video-IMU 整合性 (= 10 点) + 画面再撮影攻撃検出
  08. pipeline-2-tp-register          [廃止] TP register は task 02 (= Pipeline 1) に統合

Phase D (Pipeline 3: 手動)
  09. pipeline-3-wilor-lerobot        WiLoR 手ポーズ推定 + LeRobot v3 dataset 構築

Phase E (検証)
  10. end-to-end-smoke                サンプル MP4 で全体を通す
```

## 依存関係

```
01 ──┬─→ 02 ──┐
     ├─→ 03 ─→ 04 ─┐
     │       05 ─┤
     │       06 ─┼──→ 10
     │       07 ─┤
     └─→ 09 ─────┘
```

01 (= 基盤) が完了すれば 02 / 03 / 09 は並列で進められる。 04-07 は 03 完了後に開始 (= 相互に並列)。 10 は 02 / 04-07 / 09 全完了後。 08 は廃止 (= 内容は 02 に吸収)。 Pipeline 2 は 02 完了 (= rootAssetId 確定) に依存する点に注意 (= 10 で初めて統合確認)。

## CUI レベルの定義

本フェーズで実装するのは以下のみ:

- Pipeline 1 を模擬する macOS Rust CLI (= 実機 iOS は別フェーズ)
- サーバの REST API + WDK workflow + Modal 関数
- Pipeline 3 を手動トリガする Python CLI

実装しないもの (= 後続フェーズ):

- iOS アプリ本体 (= 撮影 UX、 音声 AI エージェント、 BGM フィードバック等)
- 撮影者向け Web ダッシュボード
- 買い手向けカタログ / マーケットプレイス
- License NFT 発行 / 収益分配 (= プログラムは v0.1.2 で実装済、 サーバ統合は別フェーズ)

## 参照する仕様書

- `/Users/forest/WebCreations/root-lens/document/v0.1.3/DATA_SPECS_JA.md` ─ データパイプライン仕様 (本フェーズの主体)
- `/Users/forest/WebCreations/root-lens/document/v0.1.3/UI_SPECS_JA.md` ─ UX 仕様 (後続フェーズ)

## v0.1.2 からの流用方針

仕様変更の度合いに応じて以下の 3 つに分類:

| 分類 | 内容 | 例 |
|---|---|---|
| **PORTABLE** | ほぼそのままコピー | `lib/auth.ts`、 `modal/bundle.py` (= 引数名のみ更新) |
| **ADAPTABLE** | 構造は流用、 logic を v0.1.3 仕様に書き換え | `lib/r2.ts` (= BLURRED バケット削除)、 `workflow/process-clip.ts` (= step 構成変更) |
| **DROP** | v0.1.3 で完全消滅 | `modal/blur.py` (= サーバ blur 廃止)、 `lib/quality.ts` (= 3 メトリクス → 4 層に総書き直し) |

詳細は各 task の「読むべきファイル」 セクション参照。

## Title Protocol 流用方針

Pipeline 1 の C2PA 署名と signature_hash 抽出は、 隣接プロジェクト Title Protocol の Rust 実装を一塊で借りる:

- 署名: `legacy/v0.1.0/crates/core/examples/sign_one.rs` の 5 行を 2 段化 (D1 + D2)
- signature_hash 抽出: `crates/core/src/c2pa_verify.rs::compute_signature_hash` + `crates/core/src/jumbf.rs`

依存は `c2pa`、 `sha2`、 `hex`、 `serde_json` の 4 つで完結。 詳細は task 02 参照。

## 進捗 (2026-05-26)

データパイプラインは production rootlens.io 上で **Pipeline 1 (= R2 upload + TP `/process` まで) + Pipeline 2 まで end-to-end 完走**。 残りは Pipeline 1 末尾の cNFT 発行 (= rootAssetId 確定) と Pipeline 3 (= ほぼ port 済) を回せば一段落。

| Task | 状態 | 備考 |
|------|------|------|
| 01 workspace-and-schema | ✅ | web/ に統合、 Supabase で table 作成済。 🔄 `rootAssetId.notNull()` への migration 必要 |
| 02 pipeline-1-mock-cli | 🔄 | 2 段 C2PA + content_id 抽出 + R2 アップロード OK、 TP `/process` 呼び出しも `tools/mock-device/src/tp_register.rs` に実装済。 ⏳ 残り: cNFT 発行 (= `/extension/solana` + Solana broadcast) → rootAssetId 確定 |
| 03 pipeline-2-server-skeleton | 🔄 | rootlens.io/api で稼働、 tp-submit step は削除済。 ⏳ 残り: `POST /api/clips` の rootAssetId 必須化 + finalize の前提条件 check |
| 04 layer-1-metadata | ✅ | smoke で score=18/20 |
| 05 layer-2-frame-sampling | ✅ | smoke で score=12/15 |
| 06 layer-3-vlm | ✅ | smoke で score=0/55 (= testsrc 入力、 想定通り) |
| 07 gtsam | ✅ | smoke で score=8/10 |
| 08 tp-register | ✅ 廃止 | 内容は task 02 に完全吸収。 サーバ tp-submit step 削除済 |
| 09 pipeline-3-wilor-lerobot | ⏳ | Modal app deploy 完了、 smoke はこれから。 入力 rootAssetId 必須 |
| 10 end-to-end-smoke | ⏳ | Pipeline 2 まで完走 (= qualityScore 38/100、 4 層内訳保存)。 cNFT 発行統合 + Pipeline 3 残り |

### 設計変更サマリ (= 当初仕様からの差分)

- **TP register を Pipeline 1 内に前倒し、 Pipeline 2 開始前に rootAssetId 必須**: 新 TP は SDK 廃止、 mock-device が R2 upload 後に `/process` + `/extension/solana` + Solana broadcast を直接実行して rootAssetId を確定させる。 サーバの tp-submit step は撤去済。 サーバへの登録 (= `POST /api/clips`) は rootAssetId 確定後にのみ行う
- **rootAssetId は notNull、 Pipeline 2 起動の前提条件**: `POST /api/clips` の必須フィールド、 DB schema 上も `notNull()`。 不在で finalize した場合サーバは 400 を返し Pipeline 2 を起動しない
- **Pipeline 3 出力 prefix は必ず `datasets/<rootAssetId>/`**: rootAssetId が Pipeline 1 完了時点で確定しているため、 content_id ベースの prefix への切替経路は存在しない

### 現フェーズで実施中

- mock-device に cNFT 発行追加 (= `/extension/solana` + Solana broadcast、 rootAssetId 確定)
- `POST /api/clips` の入力スキーマに `rootAssetId` (= notNull) 追加
- DB schema migration (= `rootAssetId` を nullable → notNull)
- end-to-end smoke を新フローに合わせて書き換え

### 次フェーズ (= データパイプライン後)

- 実機 iOS で同じフローを再現 (= Secure Enclave 鍵 + Background URLSession + Solana wallet 連携)
- 撮影者向け Web ダッシュボード

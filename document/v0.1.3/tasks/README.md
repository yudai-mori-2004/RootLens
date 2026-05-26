# RootLens v0.1.3 タスク一覧

データパイプラインを CUI レベルで end-to-end 通すまでの実装単位。 各 task は独立した PR / 実装ユニットとして扱う。

## 全体マップ

```
Phase A (基盤)
  01. workspace-and-schema           v0.1.3/server/ の骨格と DB schema

Phase B (Pipeline 1: 端末模擬)
  02. pipeline-1-mock-cli             Rust CLI で raw MP4 → 2 段 C2PA + 顔ぼかし + R2 アップロード

Phase C (Pipeline 2: サーバ自動)
  03. pipeline-2-server-skeleton      API endpoints + WDK workflow 骨格 + lib/mapper
  04. pipeline-2-layer-1-metadata     第 1 層 (sensors.jsonl + imu_high_rate.jsonl で 20 点)
  05. pipeline-2-layer-2-frame-sampling 第 2 層 (フレームサンプル画像解析で 15 点)
  06. pipeline-2-layer-3-vlm          第 3 層 (Claude Haiku 4.5 で 55 点)
  07. pipeline-2-gtsam                Video-IMU 整合性 (= 10 点) + 画面再撮影攻撃検出
  08. pipeline-2-tp-register          Title Protocol register で Root NFT 発行

Phase D (Pipeline 3: 手動)
  09. pipeline-3-wilor-lerobot        WiLoR 手ポーズ推定 + LeRobot v3 dataset 構築

Phase E (検証)
  10. end-to-end-smoke                サンプル MP4 で全体を通す
```

## 依存関係

```
01 ──┬─→ 02
     ├─→ 03 ─→ 04 ─┐
     │            ├──→ 08 ──┐
     │       05 ─┤          │
     │       06 ─┤          ├──→ 10
     │       07 ─┘          │
     └─→ 09 ─────────────────┘
```

01 (= 基盤) が完了すれば 02 / 03 / 09 は並列で進められる。 04-08 は 03 完了後に開始、 04-07 は相互に並列。 08 は 04-07 全完了後。 10 は 02 / 08 / 09 全完了後。

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

# RootLens v0.1.3 タスク一覧

## 全体マップ

```
Phase A-E (データパイプライン, CUI レベル)                    ← 完了
  01. workspace-and-schema       ✅  web/ 骨格 + DB schema
  02. pipeline-1-mock-cli        ✅  Rust CLI: C2PA + blur + R2 + TP + cNFT + /api/clips
  03. pipeline-2-server-skeleton ✅  API + WDK workflow (4 step)
  04. pipeline-2-layer-1         ✅  メタデータ解析 20 点
  05. pipeline-2-layer-2         ✅  フレームサンプリング 15 点
  06. pipeline-2-layer-3         ✅  VLM セマンティック 55 点
  07. pipeline-2-gtsam           ✅  Video-IMU 整合性 10 点
  08. (廃止)                         TP register → task 02 に吸収
  09. pipeline-3-wilor-lerobot   ✅  WiLoR + LeRobot v3 dataset
  10. end-to-end-smoke           ✅  949MB 動画で Pipeline 1-2 完走、Pipeline 3 処理中

Phase F (iOS アプリ)
  11. app-shell                      3 タブ構造 + Privy 認証 + ナビゲーション
  12. capture-pipeline               Pipeline 1 の iOS ネイティブ実装
  13. voice-agent                    音声 AI エージェント (sherpa-onnx + Claude Haiku + TTS)
  14. camera-mode                    撮影モード (対話 + カメラサブモード)
  15. home-tab                       ホームタブ (クリップ管理 + ステーキング + 収益)
  16. onboarding-settings            オンボーディング + 設定タブ
```

## 依存関係

```
Phase A-E (完了)
  01 → 02,03,09 → 04-07 → 10

Phase F (iOS)
  11 ──→ 12 ──→ 14
   │      │
   │      └──→ 15
   │
   └──→ 13 ──→ 14
   │
   └──→ 16
```

11 (= アプリ骨格) が完了すれば 12, 13, 16 は並列可。14 は 12 + 13 両方に依存 (= 録画 + 音声が揃って初めて撮影モードが成立)。15 は 12 完了後 (= /api/clips が呼べてクリップ行がある状態)。

## iOS アプリの既存資産 (rootlens-mobile)

sandbox と native module として既にプロトタイプが存在する:

| module / sandbox | 内容 | 状態 |
|---|---|---|
| `modules/sensor-session` | カメラキャプチャ + IMU + depth (Swift) | 録画 + センサー書き出し動作 |
| `modules/c2pa-bridge` | C2PA D1+D2 署名 (Swift, c2pa-rs FFI) | ビルド通る、署名 OK |
| `modules/hand-pose` | ハンドトラッキング (Android MediaPipe / iOS は sensor-session 内) | Android 実装あり |
| `modules/aes-gcm` | AES-GCM 暗号 (Swift) | 動作 |
| `sandboxes/01-hand-pose-gesture` | ジェスチャー検出 UI (パーム / サムズアップ) | プロトタイプ |
| `sandboxes/02-vlm-task-gate` | VLM 開始/終了条件チェック | プロトタイプ |
| `sandboxes/04-collection-flow` | 撮影フロー全体 (タスク選択 → カウントダウン → 録画 → 結果 → mint) | 状態機械 + UI コンポーネント |

Phase F のタスクはこれらを本番化する作業。ゼロからの新規実装ではない。

## 仕様書

| 文書 | 役割 |
|---|---|
| `DATA_SPECS_JA.md` | データパイプライン仕様 (Phase A-E の根拠) |
| `UI_SPECS_JA.md` | UX 仕様 (Phase F の根拠) |

## Phase A-E 完了時の検証結果 (2026-05-27)

949MB / 1920x1080 / 7.7 分の実動画で全パイプライン通過:

```
Pipeline 1 (mock-device prod, 3 分 24 秒)
  C2PA D1+D2, Apple Vision blur (30 faces / 13,855 frames),
  R2 upload (405MB), TP /process (signature_hash 一致),
  cNFT mint (devnet, root_asset_id=8DSYetb...),
  POST /api/clips (clip_id=clip_f72a1a796ba4_mpn38fdt)

Pipeline 2 (server, 1 分 22 秒)
  metadata=18, frame-sampling=14, vlm=14, gtsam=6, total=52/100

Pipeline 3 (Modal GPU)
  WiLoR + LeRobot v3 dataset bundle (13,855 frames, 処理中)
```

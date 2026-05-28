# RootLens v0.1.3 タスク一覧

## 2026-05-27 大方針転換のサマリ

実機実験を踏まえてヘッドマウント特化に振り切り、 以下を撤去した:

- 音声 AI エージェント (= sherpa-onnx wake / STT、 Claude Haiku 対話、 TTS 応答)
- 撮影前のタスク事前選択 (= Pipeline 2 の VLM が事後分類する)
- VLM 撮影開始 / 終了ゲート (= 同上、 Pipeline 2 のラベリングで完結)
- GTSAM Video-IMU 整合性層 (= サーバ ops コスト見合わず、 VLM `authenticity` で代替)
- ARKit world tracking (= ultra-wide camera を選べない、 発熱大、 6DoF は LeRobot 必須ではない)
- 撮影中の hand framing BGM 連動フィードバック (= キャリブレーション前提で手は基本映る)

新仕様の中核:

- 撮影モード = キャリブレーションサブモード + 撮影サブモード の 2 layer
- 撮影サブモードはジェスチャーのみ (= オープンパームで開始、 サムズアップで終了)
- 手が 5 秒以上映らないと警告音 (= キャリブレーション baseline からの逸脱通知)
- カメラは AVCaptureSession + 背面 ultra-wide camera (= 0.5x)
- IMU は CoreMotion (`CMMotionManager`)

仕様の根拠は [`UI_SPECS_JA.md`](../UI_SPECS_JA.md) と [`DATA_SPECS_JA.md`](../DATA_SPECS_JA.md) を参照。 旧 task 13 / 14 の実装作業は新方針で再設計が必要。 既存 code (= modules/arkit-capture、 modules/voice-input、 services/vlmGate、 services/voiceAgent 等) は段階削除予定 (= 新 layer 完走後に rm)。

## 全体マップ

```
Phase A-E (データパイプライン, CUI レベル)
  01. workspace-and-schema       ✅  web/ 骨格 + DB schema
  02. pipeline-1-mock-cli        ✅  Rust CLI: C2PA + blur + R2 + TP + cNFT + /api/clips
  03. pipeline-2-server-skeleton ✅  API + WDK workflow
  04. pipeline-2-layer-1         ✅  メタデータ解析 20 点
  05. pipeline-2-layer-2         ✅  フレームサンプリング 15 点
  06. pipeline-2-layer-3         🔄  VLM セマンティック 65 点 + 自動ラベリング (= 旧 55 点版から再設計)
  07. (廃止)                         GTSAM Video-IMU 整合性層 (= 2026-05-27 撤去)
  08. (廃止)                         TP register → task 02 に吸収
  09. pipeline-3-wilor-lerobot   🔄  WiLoR + LeRobot v3 (= observation.state / tracking_state 廃止、 行動ラベル集約に変更)
  10. end-to-end-smoke           🔄  方針転換で再走必要

Phase F (iOS アプリ)
  11. app-shell                  ✅  3 タブ構造 + 認証抽象 + ナビゲーション
  12. capture-pipeline           🔄  ARKit → AVCaptureSession + ultra-wide camera + CoreMotion IMU に再設計
  13. (廃止)                         音声 AI エージェント (= 2026-05-27 撤去、 sherpa-onnx + voice agent 削除)
  14. calibration-and-capture    新  キャリブレーション + ジェスチャー撮影の 2 layer (= 旧 14 camera-mode を再設計)
  15. home-tab                   🔄  自動分類カテゴリ + 3 層スコア表示に追従
  16. onboarding-settings        🔄  キャリブレーション再実行 + マイク権限除去
```

凡例: ✅ = 完了、 🔄 = 方針転換で再設計が必要、 新 = 新規追加。

## 依存関係

```
Phase A-E
  01 → 02, 03, 09 → 04-06 → 10

Phase F (iOS)
  11 ──→ 12 ──→ 14
   │      │
   │      └──→ 15
   │
   └──→ 16
```

12 (= 新 capture-pipeline) が完了すれば 14 (= calibration-and-capture) に進める。 14 は録画 native module (= 12) に依存。 15 と 16 は 12 完了後。

旧依存にあった「14 は 13 (voice-agent) に依存」 は voice-agent 撤去で消えた。 旧仕様の 14 が想定していた「対話サブモード」 はキャリブレーションサブモードに置き換わり、 voice / 音声 AI 要素を含まない。

## iOS アプリの既存資産

撤去 / 再設計対象:

| 既存 module / service | 状態 | 処置 |
|---|---|---|
| `modules/arkit-capture` | 動作中 (= 旧 12 で本番化) | 新 12 で AVCaptureSession + ultra-wide に置換、 完走後に削除 |
| `modules/voice-input` | sherpa-onnx 統合済み | 撤去対象、 新 14 完走後に削除 |
| `modules/c2pa-bridge` | 動作中 | 維持 (= Pipeline 1 C2PA 署名は継続) |
| `modules/privacy-blur` | 動作中 | 維持 (= Apple Vision 顔ぼかしは継続) |
| `modules/hand-pose` | プロトタイプ | 維持 (= ジェスチャー検出に必須) |
| `modules/sensor-session` | プロトタイプ | 新 12 のベースとして再評価 |
| `services/vlmGate.ts` | 動作中 | 撤去対象 (= VLM gate 廃止) |
| `services/voiceAgent.ts` | 動作中 | 撤去対象 |
| `services/voiceInputModelLoader.ts` | 動作中 | 撤去対象 |
| `services/voicePref.ts` | 動作中 | 撤去対象 |
| `services/realtimeFeedback.ts` | 動作中 (= drift 方向音声 + BGM 連動) | 撤去対象、 警告音 1 種類だけ別途実装 |

Phase F の Phase II 作業はこれらの撤去と新撮影 layer の構築。

## 仕様書

| 文書 | 役割 |
|---|---|
| `UI_SPECS_JA.md` | UX 仕様 (= Phase F の根拠、 2026-05-27 大改修済み) |
| `DATA_SPECS_JA.md` | データパイプライン仕様 (= Phase A-E + Pipeline 2 の VLM 自動ラベリング追加) |

## Phase A-E 完了時の検証結果 (= 2026-05-27 大方針転換前のデータ)

949MB / 1920×1080 / 7.7 分の実動画で全パイプライン通過した実績:

```
Pipeline 1 (mock-device prod, 3 分 24 秒)
  C2PA D1+D2、 Apple Vision blur (= 30 faces / 13,855 frames)、
  R2 upload (= 405MB)、 TP /process (= signature_hash 一致)、
  cNFT mint (= devnet, root_asset_id=8DSYetb...)、
  POST /api/clips (= clip_id=clip_f72a1a796ba4_mpn38fdt)

Pipeline 2 (server, 1 分 22 秒)
  metadata=18, frame-sampling=14, vlm=14, gtsam=6, total=52/100  ← 旧 4 層配点

Pipeline 3 (Modal GPU)
  WiLoR + LeRobot v3 dataset bundle (= 13,855 frames、 処理中)
```

新 3 層配点 (= GTSAM 撤去 + VLM 55 → 65) + ultra-wide camera (= ARKit → AVCaptureSession) で再 E2E smoke が必要。

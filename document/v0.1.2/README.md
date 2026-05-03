# v0.1.2: Physical AI 家事データ収集 — Sandbox 検証フェーズ

## プロダクト方針

モバイルデバイスで家庭内の家事を撮影し、Physical AI (ヒューマノイドロボット / VLA モデル) の訓練データとして売買するプラットフォーム。

ユーザーは「タスク定義」(何をするか / 開始条件 / 終了条件) を指定し、撮影中は常に両手がフレーム内に映っていることが求められる。開始/終了は手のジェスチャーで切り替え、その瞬間のスナップショットが指定条件を満たしているかを VLM が自動判定する。

撮影データには IMU / hand pose / ARKit・ARCore tracking data を同梱し、映像と物理信号の整合性 (GTSAM ImuFactor) で画面撮影等のスプーフィングを検出する。撮影終了時に C2PA 署名を付与し、データが撮影以降改竄されていないことを保証する。

出力形式は MP4 + JSON sidecar (full-rate IMU、hand pose、camera pose、C2PA、device / task metadata)。buyer 向けに LeRobot v3.0 / RLDS converter を同梱する。

## v0.1.2 の目的

上記パイプラインを構成する各パーツが、モバイルデバイス上で実際に動作するかを独立に検証する。全パーツが動くことを確認した後、メインストリームの統合実装に入る。

v0.1.2 は仕様策定前の検証フェーズであり、仕様書 (SPECS_JA) / COVERAGE は統合実装フェーズで起こす。

## Sandbox 一覧

| # | Sandbox | 検証内容 |
|---|---|---|
| 01 | [Hand Pose + Gesture](tasks/01-hand-pose-gesture/) | 21 関節リアルタイム取得 + 開始/終了ジェスチャー検出 |
| 02 | [VLM Task Gate](tasks/02-vlm-task-gate/) | スナップショット → Gemini Robotics-ER 1.6 → 条件マッチ判定 |
| 03 | [Video-IMU Consistency](tasks/03-video-imu-consistency/) | GTSAM ImuFactor による映像-IMU 整合性 residual 算出 |

## 既存資産 (v0.1.1 から継続利用)

- `app/modules/sensor-session/` — SensorSession 抽象 + Camera / IMU ネイティブ実装 (Pixel 10 で 22 assertion 動作実績)
- `app/modules/c2pa-bridge/` — c2pa-rs FFI + TEE 署名
- `app/src/sensors/` — ISensor TypeScript 抽象

これらは sandbox で再検証せず、統合実装フェーズで流用する。

## 退避済みコード

v0.1.0 / v0.1.1 の旧機能コード (screens, navigation, services, store, hooks, components) は `legacy/v0.1.1/app-src/` に退避。git history で全て参照可能。

## 市場背景

- 買い手: Figure (Project Go-Big), Physical Intelligence (π0.5), NVIDIA (GR00T), Skild AI, 1X 等
- 競合: Micro1 (4,000 worker, $15/hr), DoorDash Tasks (2026/3 launch), Build AI (100K hr Apache 2.0), Lightwheel
- buyer 側単価: $75-150/hr (bimanual household)、ユーザー還元: $20-30/hr (先進国)
- 先行データセット: EgoDex (Apple, 829hr, 3D hand pose, CC-BY-NC-ND), Ego4D (Meta, 3,670hr)

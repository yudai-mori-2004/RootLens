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

**Sandbox 検証 (01-05)** — 各パーツが単体で動くか確認するためのもの。実装は throwaway 扱い。

| # | Sandbox | 検証内容 |
|---|---|---|
| 01 | [Hand Pose + Gesture](tasks/01-hand-pose-gesture/) | 21 関節リアルタイム取得 + 開始/終了ジェスチャー検出 |
| 02 | [VLM Task Gate](tasks/02-vlm-task-gate/) | スナップショット → Gemini Robotics-ER 1.6 → 条件マッチ判定 |
| 03 | [Video-IMU Consistency](tasks/03-video-imu-consistency/) | GTSAM ImuFactor による映像-IMU 整合性 residual 算出 |
| 04 | [Collection Flow](tasks/04-collection-flow/) | 01 + 02 + 録画を結合した統合デモ (タスク選択 → ジェスチャー連動 → mp4 出力) |
| 05 | [Title Protocol register (Android port)](tasks/05-tp-register/) | sandbox 04 のクリップを TP に登録 → Solana devnet 上で Core NFT mint。Android 録画ネイティブを iOS と揃える |

**統合ユニット (06+)** — 統合フェーズでそのまま使う production-bound コード。各ユニットは独立して動作し audit grade のテストでガードされる。

| # | Unit | 役割 |
|---|---|---|
| 06 | [License NFT Solana program (Unit D)](tasks/06-license-nft-program/) | SPECS §5 — issue_license / claim_revenue。Bubblegum proof 検証 + USDC 95:5 分配を atomic に実行 |
| 07 | [Co-sign API server (Unit E)](tasks/07-co-sign-api/) | SPECS §5.3 / §6.3 — KMS で守られた hot wallet が delegate co-sign を提供。catalog/price 等のポリシー検証は web 側、on-chain 検証は D に委ねる |
| 08 | [Staking client (Unit G)](tasks/08-staking-client/) | SPECS §4.2 / §4.5 — Bubblegum delegate 命令の TS ラッパー。Root NFT の delegate を E の cosign authority に切替/解除する |
| 09 | [TEE + C2PA 撮影署名 (Unit A)](tasks/09-tee-c2pa/) | SPECS §2.7 / §4.4 / §4.6 — Secure Enclave / StrongBox 内で生成した鍵で C2PA 署名。**iOS のみ verified。Android は意図的に空、後続タスク** |
| 10 | [TP register client (Unit B)](tasks/10-unit-b-tp-register/) | SPECS §3 — 任意のメディア + owner wallet を受け取り Solana devnet 上で Root NFT を発行。クライアント側に永続鍵を持たない。本番 consumer = sandbox 04 MintView |
| 11 | [R2 upload + dedup (Unit F)](tasks/11-unit-f-r2-upload/) | SPECS §4.3 — TP から得た content_hash を R2 object key にして HEAD ベースで dedup。新規アップロードのみ presigned PUT URL を発行する |
| 12 | [VLM gate server (Unit H)](tasks/12-unit-h-vlm-gate/) | SPECS §2.3 step 3 / step 6 — 撮影 frame + 条件文を受けて Claude Sonnet で `{score, match, reason}` を返す server-side endpoint。API key を device から取り上げ、prompt injection 耐性を持たせる |
| 13 | [Privacy blur — face only (Unit C)](tasks/13-unit-c-privacy-blur/) | SPECS §2.3 step 7 / §2.5 — 録画済 mp4 の顔を Vision で検出し on-device で Gaussian blur。**iOS のみ。テキスト blur は scope 外** (= 業界標準 / Meta EgoBlur 公式と同じ判断、 §2.5 参照) |

## 仕様 + 設計ドキュメント

- [SPECS_JA.md](SPECS_JA.md) — 全体仕様
- [QUICKSTART.md](QUICKSTART.md) — License NFT のデプロイ手順 (Phase 1 setup)
- [architecture/](architecture/) — Unit 単位のアーキテクチャ詳細 (License NFT trust model, troubleshooting 等)
- [license-templates/](license-templates/) — ライセンス条文テンプレート (commercial-v1, training-only-v1, etc.)

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

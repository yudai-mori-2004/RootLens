# CLAUDE.md

## Project Overview

RootLens: Physical AI (ヒューマノイドロボット / VLA モデル) の訓練データとして、家庭内の家事映像をモバイルデバイスで収集し売買するプラットフォーム。撮影来歴の署名 (C2PA + sensor 同梱) で出自を明確化する。

- 現行フェーズ: `document/v0.1.2/` — Sandbox 検証フェーズ (仕様策定前)
- 過去仕様: `document/v0.1.0/SPECS_JA.md`, `document/v0.1.1/tasks/`
- 退避済み旧コード: `legacy/v0.1.1/app-src/`
- Title Protocol: `../title-protocol/` (別リポジトリ)

## Current Phase (v0.1.2)

各パーツが実機で動くかの独立検証。詳細は `document/v0.1.2/README.md` 参照。

| Sandbox | 内容 | 場所 |
|---|---|---|
| 01 Hand Pose + Gesture | 21 関節取得 + ジェスチャー検出 | `app/src/sandboxes/01-hand-pose-gesture/` |
| 02 VLM Task Gate | Gemini Robotics-ER 1.6 による条件判定 | `app/src/sandboxes/02-vlm-task-gate/` |
| 03 Video-IMU Consistency | GTSAM ImuFactor による整合性検証 | サーバーサイド Python |

## Architecture (v0.1.2 時点)

検証フェーズのため、統合アーキテクチャは未確定。以下は確定済みのパーツ:

- **Mobile App**: React Native (Expo 52) + Expo Modules (ネイティブモジュール)
- **Hand pose**: iOS Vision / Android MediaPipe HandLandmarker
- **VLM**: Gemini Robotics-ER 1.6 API
- **Video-IMU consistency**: GTSAM ImuFactor + OpenCV KLT (サーバーサイド)
- **C2PA 署名**: c2pa-rs FFI + TEE (v0.1.1 既存資産)
- **出力形式**: MP4 + JSON sidecar + LeRobot v3 / RLDS converter

## Development Methodology

### 原則: 仕様駆動 × テスト駆動 × タスク駆動

Title Protocolと同じ三本柱を採用するが、モバイル開発の特性に合わせて柔軟に運用する。

### 仕様書 = Source of Truth

- v0.1.2 は仕様策定前の検証フェーズ。仕様書 (SPECS_JA) / COVERAGE は統合実装フェーズで起こす
- 過去仕様: `document/v0.1.0/SPECS_JA.md` (v0.1.0 の定義。変更不可)
- コード内のdoc commentから仕様書セクションを参照する (例: `// 仕様書 §4.3 PKI構造`)

### タスク設計は段階的に

Title Protocolでは事前に全37タスクを設計したが、RootLensでは以下の理由からタスクを走りながら設計する:

- **React Native + ネイティブモジュール**: ビルドが通るまでの試行錯誤が予測困難
- **c2pa-rsクロスコンパイル**: iOS/Android向けリンクで未知の問題が出うる
- **端末TEE (Secure Enclave / StrongBox)**: 実機でしかわからない挙動がある
- **UI**: 触って初めてわかる問題が多い

がんじがらめの方針は、モバイル開発では「仕様に合わせるための作業」が本来の開発を圧迫するリスクがある。確実に役立つ最小限だけ先に決め、開発が進む中で方針を育てる。

**今決めていること:**
- 仕様書がSource of Truth
- CLAUDE.mdにプロジェクト概要・ビルド方法・アーキテクチャを記載
- COVERAGE.mdで仕様⇔実装の対応を追跡

**開発が進んでから決めること:**
- タスクの粒度やフォーマット (ネイティブモジュールのスパイクをやってみてから)
- UIに関するタスクの完了条件 (RN環境を立ち上げてから)
- テスト方針 (何がテストしやすく何がしにくいか、体感してから)
- コンポーネント間の統合テスト仕様

### 1タスク = 1セッション

コンテキストオーバーフローを防ぐため、Title Protocolと同様に1タスク1セッションを基本とする。

## Coding Conventions

- Doc comments with spec section references (例: `// 仕様書 §5.1`)
- UI上に技術用語を直接表示しない (仕様書 §3.1.2 の用語マッピングに従う)
- 完了バージョンの仕様書 (`document/v0.1.0/` 等) は誤り修正以外で変更しない

## Build

(プロジェクトセットアップ後に追記)

## Key Design Decisions

### オフチェーンストレージについて

- signed_json の保存先に言及する場合は「オフチェーンストレージ」「json_uri の指す先」等の一般名称を使う。特定のストレージサービス名を推測で挙げない。
- ストレージの種類は検証の信頼性に影響しない（TEE署名で自己証明的な設計）。

(その他の設計判断は開発の進行に伴い追記)

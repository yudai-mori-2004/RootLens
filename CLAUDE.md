# CLAUDE.md

## Project Overview

RootLens: カメラで撮影された「本物のコンテンツ」であることを証明し、SNS等で共有可能なリンクとして発行するモバイルアプリケーション。Title Protocol上に構築される最初のアプリケーション。

- 仕様書: `document/v0.1.0/SPECS_JA.md` (Source of Truth)
- カバレッジ: `document/v0.1.0/COVERAGE.md`
- タスク: `document/v0.1.0/tasks/NN-name/` (段階的に追加)
- Title Protocol: `../title-protocol/` (別リポジトリ)

## Architecture

```
[React Native App]           [RootLens Server]           [Public Page (rootlens.io)]
  Camera / Gallery              CA (Device Cert)            Client-side verification
  C2PA signing (TEE)            Page ID management          Solana RPC direct
  Editing                       Whitelist API               pHash recomputation
  Title Protocol SDK            R2 / Supabase
  Privy auth                    Privy auth
       |                             |                            |
       +-------- Title Protocol -----+----------- Solana ----------+
```

### Components

| Component | Tech | Role | Spec |
|-----------|------|------|------|
| Mobile App | React Native + Kotlin/Swift + c2pa-rs | 撮影・署名・編集・公開 | §2-6 |
| Native Module | c2pa-rs (FFI) + TEE API | C2PA署名・TEE鍵操作 | §4 |
| Server | Next.js API Routes | CA・ページ管理・ストレージ | §4.4, §7, §10 |
| Public Page | rootlens.io (static + JS) | トラストレス検証・表示 | §7 |
| Database | Supabase (PostgreSQL) | ページ・コンテンツ・ユーザー管理 | §10.4 |
| Storage | Cloudflare R2 (2 buckets) | バイナリデータ保存 | §6.2 |

## Development Methodology

### 原則: 仕様駆動 × テスト駆動 × タスク駆動

Title Protocolと同じ三本柱を採用するが、モバイル開発の特性に合わせて柔軟に運用する。

### 仕様書 = Source of Truth

- `document/v0.1.0/SPECS_JA.md` が唯一の仕様定義
- コード内のdoc commentから仕様書セクションを参照する (例: `// 仕様書 §4.3 PKI構造`)
- 仕様と実装の乖離が生じた場合、仕様を先に更新してから実装を修正する

### COVERAGE.md

- 仕様書の各セクションに対する実装状況を追跡する
- タスク完了時に更新する
- 凡例: 実装済み / 型のみ / スタブ / 未着手 / 対象外

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

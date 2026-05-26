# CLAUDE.md

## Project Overview

RootLens: Physical AI (= ヒューマノイドロボット / VLA モデル) の訓練データとして、 家庭内の家事映像をモバイル端末で収集し売買するプラットフォーム。 撮影来歴の署名 (C2PA + センサーデータ同梱) で出自を明確化する。

- 現行フェーズ: **v0.1.3** (= データパイプライン production 稼働中)
- 仕様: `document/v0.1.3/DATA_SPECS_JA.md` + `document/v0.1.3/UI_SPECS_JA.md`
- task 進捗: `document/v0.1.3/tasks/README.md`
- 過去仕様: `document/v0.1.0..v0.1.2/` (= 参照用に保持、 触らない)
- Title Protocol: `../title-protocol/` (= 隣接リポジトリ、 v0.1.3 で `/process` Gateway 直叩きに移行)

## リポジトリ構造 (= 2 本柱 + 周辺)

```
root-lens/
├── web/                Next.js 16 App Router (= rootlens.io、 Vercel link 済)。 LP + REST API + WDK workflow
├── app/                React Native (= Expo)。 撮影端末アプリ
│
├── native/             app + web から参照する Rust crate
│   ├── c2pa-bridge/    iOS / Android FFI
│   └── jarosz-wasm/    web public/wasm/ 用
├── programs/           Anchor program (= license-nft on Solana)
├── crates/             Rust CLI (= license-cli)
├── tests/              Anchor program の TS テスト
│
├── tools/              web / app 以外の周辺 dev / ops ツール
│   ├── mock-device/    iOS 端末を模擬する macOS Rust CLI (= Pipeline 1 mock + TP /process)
│   ├── modal/          Modal Python 関数 5 本 (= layer1-3 + gtsam + bundle)
│   ├── macos-blur/     Apple Vision 顔ぼかし Swift CLI
│   ├── lp-sample/      LP 用 dataset build / upload Python 群
│   ├── asset-gen/      LP イラスト生成
│   ├── gen-dummy-sensors.py
│   └── smoke-test.sh   end-to-end smoke (= mock-device → R2 → /api/clips → Pipeline 2 → Pipeline 3)
│
├── certs/              dev PKI (= Root CA + ICA + server leaf + 生成スクリプト)
├── keys/               ローカル秘密鍵 (= .gitignore 済)
└── document/           仕様 + 過去仕様
    └── v0.1.3/         current spec + tasks/
```

兄弟 repo: `../rootlens-mobile/` (= v0.0.x Android + Solana Seeker hackathon 系、 別系統で並行開発、 root-lens/app/ とは内容が大きく重なるが意図的に分離維持)

## データパイプライン (= v0.1.3)

3 段構成。 各 pipeline はデータへのリンクを入力に取り、 データへのリンクを出力する純粋関数として設計される (= `document/v0.1.3/DATA_SPECS_JA.md` §1)。

| Pipeline | 場所 | 役割 |
|---|---|---|
| 1 (端末) | `tools/mock-device/` (= iOS 実機実装は別フェーズ) | 撮影 → C2PA D1 → 顔ぼかし → C2PA D2 → content_id 抽出 → R2 アップロード → TP `/process` 並列呼び出し |
| 2 (サーバ、 自動) | `web/workflow/process-clip.ts` + `tools/modal/{layer1_metadata,layer2_frame_sampling,layer3_vlm,gtsam_eval}.py` | 4 層スコアリング (= metadata 20 + frame sampling 15 + VLM 55 + GTSAM 10) で 0..100 点 |
| 3 (サーバ、 手動) | `tools/modal/bundle.py` | WiLoR 手ポーズ推定 + LeRobot v3 dataset 構築 |

TP register は v0.1.3 で client-driven 化された (= 新 Gateway は `POST /process` を直叩き、 SDK 廃止)。 サーバ workflow からは tp-submit step を削除済、 mock-device が R2 upload 後に並列で TP を呼ぶ。

## 動作確認 (= production)

- web: `https://rootlens.io` (= Vercel auto deploy on main push)
- API: `https://rootlens.io/api/clips` 系 + `/api/clips/:id/finalize` で WDK workflow キック
- Modal: workspace `yudai-mori-2004`、 5 app 全 deploy 済
  - rootlens-layer1-metadata、 rootlens-layer2-frame-sampling、 rootlens-layer3-vlm、 rootlens-gtsam-eval、 rootlens-bundle
- DB: Supabase (= web/drizzle/ + web/scripts/apply_migrations.mjs)。 drizzle-kit push は Supabase の auth/storage schema introspection で内部バグを踏むため使わない
- R2 buckets: `rootlens-raw` (= raw/<content_id>/) + `rootlens-datasets` (= datasets/<...>/) の 2 つ

smoke test の実行:

```
API_BASE=https://rootlens.io bash tools/smoke-test.sh
```

これで mock-device → R2 → finalize → Pipeline 2 (= 4 step) → state=ready → Pipeline 3 (= bundle) まで通る。

## Development Methodology

### 原則: 仕様駆動 + タスク駆動

`document/v0.1.3/DATA_SPECS_JA.md` (= データパイプライン) と `UI_SPECS_JA.md` (= UX) が Source of Truth。 タスクは `document/v0.1.3/tasks/01..10/` に分割、 各 README に「目的 / 読むべきファイル / スコープ (= やること / やらないこと) / 成功基準 / 進捗」 を持つ (Title Protocol 形式)。

### 1 タスク = 1 セッションを基本

コンテキストオーバーフローを防ぐ。 大きい task は worktree なしで進める (= user 方針)。

### Commit 規約

- メッセージは英語 (= 「Git commit messages in English」 memory に従う)
- 1 つの設計判断 = 1 commit (= bisect 可能性を保つ)
- 大規模 mv は `git mv` で history を保つ

## Coding Conventions

- TypeScript / Python は仕様書セクション参照を doc comment に書く (例: `// DATA_SPECS §3.2.4`)
- 公開向け文章 (= LP / dataset card) には内部設計プロセスを混ぜない (= `feedback_no_internal_process_in_public` 参照)
- 完了バージョンの仕様書 (= `document/v0.1.0..v0.1.2/`) は誤り修正以外で変更しない

## Key Design Decisions

### TP register は client-driven

v0.1.3 で Title Protocol が SDK 廃止 + `POST /process` 直叩き経路に切替。 サーバ workflow は scoring に集中 (= 4 step)、 TP register は mock-device 側で R2 upload 後に並列実行。 cNFT 発行 (= `POST /extension/solana` + Solana broadcast) は次フェーズで mock-device に追加予定。 仕様上 `rootAssetId` は notNull だが MVP では nullable 許容。

### Pipeline 3 出力 prefix

rootAssetId が確定するまでは `datasets/<content_id>/` で代用 (= bundle.py が content_id を引数で受ける)。 cNFT 発行後に rename / migrate。

### オフチェーンストレージについて

- signed_json の保存先に言及する場合は「オフチェーンストレージ」 「json_uri の指す先」 等の一般名称。 特定のストレージサービス名を推測で挙げない
- ストレージの種類は検証の信頼性に影響しない (= TEE 署名で自己証明的な設計)

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
├── native/             app から参照する Rust crate
│   └── c2pa-bridge/    iOS / Android FFI (= v0.1.4 で iOS 実機統合復活時の起点)
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
├── keys/               ローカル秘密鍵 (= .gitignore 済)
└── document/           仕様 + 過去仕様
    └── v0.1.3/         current spec + tasks/
```

兄弟 repo: `../rootlens-mobile/` (= v0.0.x Android + Solana Seeker hackathon 系、 別系統で並行開発、 root-lens/app/ とは内容が大きく重なるが意図的に分離維持)

## データパイプライン (= v0.1.3)

3 段構成。 各 pipeline はデータへのリンクを入力に取り、 データへのリンクを出力する純粋関数として設計される (= `document/v0.1.3/DATA_SPECS_JA.md` §1)。

| Pipeline | 場所 | 役割 |
|---|---|---|
| 1 (端末) | `tools/mock-device/` (= iOS 実機実装は別フェーズ) | 撮影 → C2PA D1 → 顔ぼかし → C2PA D2 → signature_hash 抽出 → R2 アップロード → TP `/process` (= signature_hash + attestation 取得 + R2 signed-json/ 保存) → cNFT 発行 (= `/extension/solana` + Solana wallet 署名 + broadcast) → rootAssetId 確定 → `POST /api/clips` でサーバ登録 |
| 2 (サーバ、 自動) | `web/workflow/process-clip.ts` + `tools/modal/{layer1_metadata,layer2_frame_sampling,layer3_vlm}.py` | 3 層スコアリング (= metadata 20 + frame sampling 15 + VLM 65) で 0..100 点。 起動条件は `clip.rootAssetId` not null。 出力 `processed/<signature_hash>/{quality_scores.json,semantic.jsonl}` |
| 3 (サーバ、 手動) | `tools/modal/wilor.py` | WiLoR 手ポーズ推定のみ。 出力 `processed/<signature_hash>/wilor.jsonl`。 データセット化 (= 複数クリップを LeRobot v3 等にまとめる) はパイプライン外 |

TP register + cNFT 発行は v0.1.3 で Pipeline 1 内に前倒し済 (= 新 Gateway は `POST /process` 直叩き、 SDK 廃止)。 サーバ workflow からは tp-submit step を完全削除済、 mock-device が R2 upload 後に TP `/process` + cNFT 発行を実行して rootAssetId を確定させてから `POST /api/clips` でサーバに登録する。

## 動作確認 (= production)

- web: `https://rootlens.io` (= Vercel auto deploy on main push)
- API: `https://rootlens.io/api/clips` 系 + `/api/clips/:id/finalize` で WDK workflow キック
- Modal: workspace `yudai-mori-2004`
  - rootlens-layer1-metadata、 rootlens-layer2-frame-sampling、 rootlens-layer3-vlm、 rootlens-wilor
  - (旧 rootlens-gtsam-eval / rootlens-bundle は廃止。 deploy 済の旧 app は別途 tear down)
- DB: Supabase (= web/drizzle/ + web/scripts/apply_migrations.mjs)。 drizzle-kit push は Supabase の auth/storage schema introspection で内部バグを踏むため使わない
- R2 buckets: `rootlens-raw` (= raw/<signature_hash>/) + `rootlens-processed` (= processed/<signature_hash>/) の 2 つ

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

### TP register + cNFT 発行は Pipeline 1 末尾

v0.1.3 で Title Protocol が SDK 廃止 + `POST /process` 直叩き経路に切替したのを契機に、 TP register + cNFT 発行を Pipeline 1 内に前倒した。 mock-device は R2 upload 後に `POST /process` (= signature_hash + attestation 取得 → R2 signed-json/ 保存) → `POST /extension/solana` (= partial_tx 取得 → Solana wallet 署名 → RPC broadcast) を実行して `rootAssetId` を確定させる。 確定後にのみ `POST /api/clips` でサーバに登録する。

`rootAssetId` は Pipeline 2 起動の前提条件として扱う (= DB schema 上 notNull、 `POST /api/clips` の必須 field、 finalize で not null check)。 確定するまで `POST /api/clips` は叩かない。 サーバから TP を呼ぶ経路は v0.1.3 で完全廃止 (= サーバ workflow は scoring 3 step のみ)。

### Pipeline 2 / 3 の出力先

Pipeline 2 / 3 の出力はいずれも `processed/<signature_hash>/` に書き出す (= raw と同じ signature_hash キーで対称、 DATA_SPECS §5)。 Pipeline 2 = `quality_scores.json` + `semantic.jsonl`、 Pipeline 3 = `wilor.jsonl`。 複数クリップをデータセット形式 (= LeRobot v3 等) にまとめる作業はパイプライン外で事後的に行う。

### オフチェーンストレージについて

- signed_json の保存先に言及する場合は「オフチェーンストレージ」 「json_uri の指す先」 等の一般名称。 特定のストレージサービス名を推測で挙げない
- ストレージの種類は検証の信頼性に影響しない (= TEE 署名で自己証明的な設計)

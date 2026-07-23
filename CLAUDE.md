# CLAUDE.md

## Project overview

RootLens: iPhone アプリで家事の一人称視点映像 + LiDAR 深度 + IMU + 手ポーズを収集し、
Embodied AI / VLA モデル向けの学習データとして FPV Labs (Stera) に渡すプラットフォーム。

- 現行フェーズ: **v0.1.4** (= C2PA / Title Protocol / Solana を撤去し、 データ収集 + 手渡し
  だけに絞った実装。 task 12 で残骸掃除まで実行済み)。
- データ仕様の正: 実装 + `app/README.md` (= 契約は型 + fail-loud チェックで強制)。 UI 参考: `document/v0.1.3/UI_SPECS_JA.md`
- タスク進捗: `document/v0.1.4/tasks/README.md`
- 過去仕様: `document/v0.1.0..v0.1.3/` (= 参照用に保持、 触らない)

## リポジトリ構造

```
root-lens/
├── web/                Next.js 16 App Router (= rootlens.io、 Vercel link 済)。 LP + REST API
├── app/                React Native (= Expo)。 撮影端末アプリ
│
├── tools/              web / app 以外の周辺 dev / ops ツール
│   ├── modal/          Modal パイプライン (1 ディレクトリ = 1 パイプライン。 各 README に入出力と実行)
│   │   ├── fpvlabs/        raw arkit → 顔ぼかし + MCAP (FPV Labs 手渡し。 現運用の中心)
│   │   ├── sample-viewer/  raw arkit → LP /sample ビューアの 6 素材 (rootlens-public)
│   │   ├── sample-drive/   raw + MCAP → 共有ドライブのサンプル一式 (ぼかし済み rgb + mcap + manifest)
│   │   ├── session-stats/  frames.jsonl → サンプル選定用の統計 JSON (stdout)
│   │   ├── session-thumbs/ rgb.mp4 → サンプル選定用サムネ 5 枚 (rootlens-public)
│   │   └── score-wilor/    旧 score 3 層 + WiLoR 手ポーズ (= legacy、 現運用外)
│   ├── egoblur_probe.py 新クリップで EgoBlur 閾値を検証するローカルハーネス
│   └── asset-gen/       LP イラスト / SFX / 撮影トグルマーカー生成
│
└── document/
    ├── legal/          法務正本 (ja 正 + en ミラー。 gen-legal.mjs のビルド入力)
    └── v0.1.4/         tasks/ (タスクログ)
        └── fpvlabs-handoff/ 運用手順 (RUNBOOK) + 未処理クリップ一覧 + FPV 向け README
```

参考リポ: `../rootlens-mobile/` (= v0.0.x Android + Solana Seeker hackathon 系、
別系統で並行開発、 意図的に分離維持)

## データフロー (v0.1.4 現行)

```
[撮影端末: app/]
  録画完了                → sha256(raw mp4) 計算 → content_hash 誕生
  → R2 rootlens-raw-arkit へ並列 PUT (rgb.mp4 + frames.jsonl +
     imu.jsonl + metadata.json + depth.tar)
  → POST /api/clips で登録 (= state='uploaded')

[サーバ: web/]
  REST API のみ (自動後段処理なし)。 /api/clips で登録、 /api/v1/raw-uploads で presigned URL、
  /api/v1/consents で同意証跡。

[運用: tools/modal/fpvlabs/]
  手動で `modal run tools/modal/fpvlabs/fpvlabs.py --content-hash <hash>` 実行。
  raw を落として EgoBlur (GPU L4) で顔ぼかし → Stera 互換 MCAP を組み立て → rootlens-fpvlabs に put。

[FPV Labs]
  rclone で rootlens-fpvlabs から MCAP を pull。 詳細は document/v0.1.4/fpvlabs-handoff/。
```

## 動作確認 (production)

- web: `https://rootlens.io` (= Vercel auto deploy on main push)
- API: `https://rootlens.io/api/clips` 系
- Modal: workspace `yudai-mori-2004`、 fpvlabs 用 image + volume `rootlens-egoblur` (= EgoBlur jit)
- DB: Supabase (= web/drizzle/ + web/scripts/apply_one_migration.mjs)。 SQL 直流し方式で、
  drizzle-kit の snapshot は使わない。
- R2 buckets:
  - `rootlens-raw-arkit` (arkit 端末の raw)
  - `rootlens-raw` (旧 ultra_wide 用、 参考残置)
  - `rootlens-fpvlabs` (FPV Labs 受け渡し用 MCAP)
  - `rootlens-public` (LP 用 / 検証テスト用のスクラッチ)

## Development methodology

### 原則: 実装が正 + タスク駆動

データ仕様の正は実装と `app/README.md`。 コンポーネント間の契約 (ファイルマニフェスト /
API 型 / スキーマ) は型と fail-loud チェックで強制し、 別文書に二重管理しない。
タスクは `document/v0.1.4/tasks/NN-name/` に分割、 各 README に「目的 / 読むべきファイル / スコープ
(= やること / やらないこと) / 成功基準 / 進捗」 を持つ。

### 1 タスク = 1 セッションを基本

コンテキストオーバーフローを防ぐ。 大きい task は worktree なしで進める (= user 方針)。

### Commit 規約

- メッセージは英語
- 1 つの設計判断 = 1 commit (= bisect 可能性を保つ)
- 大規模 mv は `git mv` で history を保つ

## Coding conventions

- コメントは今のコードの説明だけを書く (= バージョン・task 番号・日付・変更履歴を書かない)
- 公開向け文章 (= LP / dataset card) には内部設計プロセスを混ぜない
- 完了バージョンの仕様書 (= `document/v0.1.0..v0.1.3/`) は誤り修正以外で変更しない

## Key design decisions

### 識別子は content_hash (= sha256 of raw mp4)

v0.1.3 まで C2PA D1 署名のハッシュを identity として使っていたが、 task 12 で C2PA 全廃と同時に
「生 mp4 のバイト列の SHA-256」 に置換。 端末で計算し、 R2 raw キー / DB PK として使う。
値の意味が変わったので、 旧 raw/<signature_hash>/ の R2 オブジェクトは orphan として残置する
(= 参照だけ切って新データは新 content_hash キーで再アップロード)。

### 顔ぼかしは EgoBlur (GPU L4、 Stera-10M と同じ)

`tools/modal/fpvlabs/fpvlabs.py`。 mediapipe は緊急時 fallback。 閾値は 0.8 (stera-sdk 既定)、
resize は 480 でコスト目標 1 時間あたり ~¥120。 実測で本物の顔は 0.97+、 誤爆は 0.3 以下で
ケタで分離する。 詳細は `document/v0.1.4/fpvlabs-handoff/RUNBOOK.md`。

### 検証用の --target-bucket

fpvlabs.py に `--target-bucket <name>` オプションを持たせて、 本番 `rootlens-fpvlabs` を書き換えずに
挙動確認できる。 検証は必ずこの経路を使う (= 過去に production を触って FPV へ渡した内容を壊した
事故がある)。

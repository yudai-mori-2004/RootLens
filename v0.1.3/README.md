# RootLens v0.1.3 ワーキングディレクトリ

v0.1.3 仕様 (= `document/v0.1.3/DATA_SPECS_JA.md` + `UI_SPECS_JA.md`) の実装ディレクトリ。
v0.1.2 (= リポジトリ直下の `server/` 以下) は legacy として手付かずで残す。 こちらは 0 から構築する。

## 構成

```
v0.1.3/
└── server/             # Next.js (App Router) + Modal + scripts
    ├── app/api/        # クリップ管理 REST API
    ├── lib/            # サーバ内ロジック (R2、 TP、 認証、 Modal HTTP wrapper)
    ├── workflow/       # WDK durable workflow (Pipeline 2 オーケストレーション)
    ├── modal/          # Modal クラウド関数 (品質スコアリング 4 層、 GTSAM、 WiLoR+LeRobot)
    ├── db/             # Drizzle ORM + Supabase スキーマ
    ├── shared/         # クライアント共通型
    ├── scripts/        # CLI 群
    │   └── mock_device/   # iOS 端末を模擬する macOS CLI (Pipeline 1 mock)
    └── drizzle/        # 自動生成 migration
```

## v0.1.2 からの主な変更

詳細は `document/v0.1.3/DATA_SPECS_JA.md` 冒頭の差分表参照。 実装影響が大きい点だけ:

- **Pipeline 1 が完全に端末側**。 サーバ側 blur (= `server/modal/blur.py`) は廃止。 端末で
  Apple Vision 顔ぼかし + 2 段 C2PA 署名 (D1 → D2) を行ってから R2 にアップロード。
- **`content_id` の定義変更**。 「ファイル SHA-256」 ではなく
  「D2 アクティブマニフェスト署名の SHA-256」。 端末で確定したら以降不変。
- **品質スコアリングが 4 層**: metadata (20) + frame sampling (15) + VLM (55) + GTSAM (10)。
  v0.1.2 の 3 メトリクス単純合計から書き直し。
- **R2 バケットが 2 つ**: `rootlens-raw` (端末 upload 後の全ファイル) + `rootlens-datasets`
  (Pipeline 3 出力)。 `blurred` バケットは廃止 (= 端末から来る rgb.mp4 が既に D2 署名済みぼかし版)。
- **DB が Supabase**。 Neon HTTP driver → postgres-js + Supabase。

## 現状の進め方

データパイプラインを CUI レベルで end-to-end 通すのが最初の目標。 実機 iOS は Pipeline 1
mock CLI で代替し、 サーバ側 (Pipeline 2 + 3) を先に固める。

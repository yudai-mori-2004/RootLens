# rootlens-server

RootLens のクライアント (= モバイルアプリ) からのクリップアップロード、 サーバ側パイプライン (= ぼかし、 派生 C2PA 署名、 品質評価、 TP 提出、 R2 配置)、 ステーキング API を提供する Next.js (App Router) サーバ。

SPECS_JA §2.7 (= クリップ状態機械) と §6.2 (= 6 ステップサーバパイプライン) を実装する。

## アーキテクチャ

- **Next.js App Router** (= API route handlers)
- **Vercel Workflow DevKit** (= サーバ再起動を跨いで resume できる durable な 6 ステップ pipeline)
- **Neon Postgres + Drizzle ORM** (= クリップ状態、 ToS 同意ログ)
- **Cloudflare R2** (= 生 MCAP + ぼかし MCAP、 egress 無料)
- **Modal** (= YuNet 顔ぼかしの CPU 推論を秒単位課金で実行)
- **Title Protocol** (= 外部、 同じ team 製。 TEE 内で C2PA 検証 + cNFT 発行)

```
mobile client                  vercel server                    external
─────────────                  ─────────────                    ────────
POST /api/clips             ───►  insert clip (uploading)
                              ◄── presigned PUT URL
PUT R2 (raw MCAP)           ─────────────────────────────────►  Cloudflare R2
POST /api/clips/:id/finalize ──►  workflow start (processing)
                                    │
                                    │ step 1: c2pa-verify
                                    │ step 2: anonymize          ───► Modal (GPU)
                                    │ step 3: derive-manifest    ───► c2pa-rs
                                    │ step 4: quality-eval       ───► Modal
                                    │ step 5: tp-submit          ───► Title Protocol
                                    │ step 6: r2-place
                                    ▼ ready
                                    push 通知 → 端末
POST /api/clips/:id/stake   ───►  Bubblegum delegate            ───► Solana
```

## 起動 (開発)

### 1. 依存インストール

```bash
cd server
npm install
```

### 2. 環境変数の準備

`.env.example` をコピーして `.env.local` に値を入れる:

```bash
cp .env.example .env.local
```

順次必要なもの:

- **`DATABASE_URL`** — Vercel Marketplace から Neon を provision して取得
- **`CLOUDFLARE_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`** — Cloudflare R2 dashboard から取得、 バケットを 2 つ作成 (`rootlens-mcap-raw`, `rootlens-mcap-blurred`)
- **`MODAL_BLUR_ENDPOINT`** — Modal で blur 関数を deploy 後、 web endpoint URL を貼る
- **`TP_NETWORK`** — `devnet` or `mainnet` (= TP SDK が GlobalConfig を読み取る Solana network)。 gateway URL は指定しない、 SDK が健全ノードを自動選択する
- **`COSIGN_AUTHORITY_SECRET_KEY`** — License NFT co-sign 用 wallet keypair (base58)
- 残りは optional / 段階導入

### 3. DB マイグレーション

```bash
npx drizzle-kit push   # 開発用、 schema を直接 Neon に反映
# 本番用は generate → migrate を使う
```

### 4. 開発サーバ起動

```bash
npm run dev
# → http://localhost:3000
```

## API

### `POST /api/clips`
撮影者「送る」 押下時にクライアントから呼ぶ。 クリップ行作成 + R2 PUT URL を返す。

### `POST /api/clips/:id/finalize`
端末が R2 への PUT を完了したら呼ぶ。 サーバはハッシュ照合の上、 状態を `uploading` → `processing` に遷移させて WDK workflow を起動。

### `GET /api/clips`
撮影者の全クリップを新しい順に返す。

### `GET /api/clips/:id`
単一クリップの最新状態を返す (= ポーリング fallback 用)。

### `POST /api/clips/:id/stake`
ステーキング画面の二段階確認後に呼ぶ。 MVP では mock、 本実装では Bubblegum delegate 命令の tx を build + 部分署名して返す。

### `DELETE /api/clips/:id`
撮影者がクリップを破棄。 `staked` 状態は削除不可 (= ライセンス永続性のため)。

すべての endpoint は `X-Wallet-Pubkey` header で wallet pubkey を渡す (MVP 認証)。 本実装では wallet 署名 challenge-response に置き換える。

## ディレクトリ構成

```
server/
├── app/api/
│   ├── clips/
│   │   ├── route.ts                    GET (list), POST (create)
│   │   └── [id]/
│   │       ├── route.ts                GET, DELETE
│   │       ├── finalize/route.ts       POST (upload 完了通知 + workflow 起動)
│   │       └── stake/route.ts          POST (ステーキング実行)
├── db/
│   ├── schema.ts                       Drizzle schema (clips, tos_consents)
│   └── client.ts                       Neon connection
├── lib/
│   ├── auth.ts                         wallet pubkey 認証
│   ├── r2.ts                           Cloudflare R2 client + presigned URL
│   ├── modal.ts                        Modal GPU 関数 invoker
│   ├── tp.ts                           Title Protocol 提出 client
│   ├── c2pa.ts                         派生 manifest 生成 (= ingredient chain)
│   ├── quality.ts                      品質スコア算出
│   └── mapper.ts                       DB row → API DTO
├── workflow/
│   └── process-clip.ts                 WDK 6 ステップ pipeline
├── shared/
│   └── api-types.ts                    client と共有する API 型
└── drizzle/                            自動生成 migration SQL
```

## 開発の進め方

MVP 実装は以下の順で進める想定:

1. **stub で動かす** (現状) — `lib/c2pa.ts` `lib/quality.ts` `lib/tp.ts` `lib/modal.ts` はすべて stub。 workflow を起動するとモック値で `ready` に遷移する
2. **R2 を本物化** — Cloudflare アカウント + access key を `.env` に入れて、 PUT / GET の事前署名 URL を実際に発行
3. **Modal で blur 関数を deploy** — Python で YuNet 顔ぼかし関数を書いて modal deploy
4. **Modal で quality eval 関数を deploy** — MCAP 解析 + メトリクス算出
5. **c2pa-rs Node binding を整える** — `lib/c2pa.ts` で実際に派生 manifest 生成 + R2 に再 PUT
6. **TP を本物化** — `../title-protocol/` を deploy 済の endpoint に向ける
7. **stake を本物化** — Bubblegum delegate tx の build + co-sign
8. **観測整備** — Vercel Logs + Sentry 等で各 step のメトリクスを取る

## クライアント側との結合

クライアント (= `../app/src/services/clipPipeline.ts`) はモックパイプラインを内蔵している。 本サーバが稼働したら、 同 file の `enqueue` / `simulatePipeline` を HTTP 呼び出しに切り替える。 API 型は `shared/api-types.ts` で揃えてある。

クライアント変更箇所:
- `POST /api/clips` で clip 作成 + presigned URL 取得
- `PUT` で R2 直接アップロード (= 進捗は XHR / fetch の progress event で観測)
- `POST /api/clips/:id/finalize` で workflow 起動
- `GET /api/clips/:id` で polling、 もしくは Expo Push で通知受信

切り替えは feature flag (= 環境変数 `EXPO_PUBLIC_USE_REAL_SERVER`) で gradual に進められるよう、 clipPipeline.ts に注入口を残す。

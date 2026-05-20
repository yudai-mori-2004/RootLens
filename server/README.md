# rootlens-server

RootLens のクライアント (= モバイルアプリ) からのクリップアップロード、 サーバ側パイプライン (= ぼかし + C2PA 署名 S、 品質評価、 TP 提出)、 ステーキング API を提供する Next.js (App Router) サーバ。

SPECS_JA §2.7 (= クリップ状態機械) と §6.2 (= サーバパイプライン) を実装する。

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
                              ◄── presigned PUT URL (4 files)
PUT R2 (rgb.mp4 + sensors)   ────────────────────────────────►  Cloudflare R2
POST /api/clips/:id/finalize ──►  workflow start (processing)
                                    │
                                    │ step 1: anonymize          ───► Modal (CPU, YuNet + C2PA 署名 S)
                                    │ step 2: quality-eval       ───► R2 から sensors.jsonl を読んで集計
                                    │ step 3: tp-submit          ───► Title Protocol
                                    ▼ ready
GET /api/clips/:id (poll)   ◄───  ready 状態を 2 秒間隔 polling
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

下記が本物化済 / 未完の差分。 silent stub は除去済 (= 未配線なら fail-loud で落ちる)。

実装済:
- R2 presigned URL 発行 / GET / PUT
- Modal blur (= YuNet + C2PA 「署名 S」) を呼ぶ wiring
- 品質評価 (= R2 raw bucket から sensors.jsonl を読んで syncRatio / frameGapCount / depthValidRatio を算出。 手検出率は Pipeline 3 で backfill)
- TP register (= `../title-protocol/` の SDK 経由)
- ステーキング (= ROOTLENS_COSIGN_DELEGATE を delegate に焼く。 未設定なら 501)
- 'error' クリップの再投入 (= POST /api/clips/:id/retry)

未完 / 次の作業:
- 端末 C2PA 「署名 A」 の verify (= 段階 2 で追加。 現状 workflow に該当 step は無い)
- Bubblegum delegate instruction の tx 構築 + 端末側 wallet 署名 + 送信 (= 現状はサーバが delegate アドレスを直接焼く簡易版)
- Expo Push 通知 (= 現状クライアントは 2 秒 polling)
- Pipeline 3 (= LeRobot dataset 整形) の Modal `bundle.py` を販売時に走らせる orchestration

## クライアント側との結合

クライアント (= `../app/src/services/clipPipeline.ts`) は本サーバを HTTP で叩く。 `EXPO_PUBLIC_SERVER_URL` 未設定なら即 throw する (= mock fallback は持たない)。 API 型は `shared/api-types.ts` で揃えてある。

エンドポイント:
- `POST /api/clips` で clip 作成 + 4 ファイル分の presigned PUT URL 取得
- `PUT` で R2 直接アップロード (= rgb.mp4 + sensors.jsonl + imu_high_rate.jsonl + camera_intrinsics.json を並列)
- `POST /api/clips/:id/finalize` で workflow 起動
- `GET /api/clips/:id` で 2 秒間隔 polling (= ready / error / staked で停止)
- `POST /api/clips/:id/retry` で 'error' クリップを再投入
- `POST /api/clips/:id/stake` でステーキング

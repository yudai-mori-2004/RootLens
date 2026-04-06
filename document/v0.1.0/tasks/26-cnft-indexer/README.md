# Task 26: cNFT フルデータインデクサ

## 目的

RootLens専用のcNFTインデクサを構築し、DAS APIの制約（attributeフィルタ非対応、ページネーション上限）を解消する。

## 背景

### 現状の問題

Web検証ページ (`helius.ts`) が `searchAssetsByCollection` でコレクション全件をlimit=100で取得し、JS側でcontent_hashフィルタリングしている。コレクション内のcNFTが100件を超えると対象のcNFTが取得できず、「3 NFTミント済みなのに2個や0個しか表示されない」問題が発生。

devnet実測: Core 1123 cNFT, Ext 248 cNFT。

### DAS APIの制約

- `searchAssets` はmetadata attribute（content_hash等）でのフィルタ不可
- コレクション単位の検索のみ → 全件取得+JSフィルタが必要 → スケールしない

## スタック

新インフラなし。既存のVercel (Next.js) + Supabase (Postgres) 上に追加。

```
Helius Webhook ──→ /api/v1/webhooks/helius (Next.js API route)
                         ↓
                  getAsset → signed_json fetch → Supabase INSERT

Vercel Cron ─────→ /api/v1/indexer/poll (Next.js API route)
                         ↓
                  差分Poll（desc順、既知到達で打ち切り）

Web検証/App ────→ Supabase `cnft_assets` WHERE network = ? AND content_hash = ?
```

## テーブル設計

```sql
create table cnft_assets (
  asset_id       text primary key,
  content_hash   text not null,
  processor_id   text not null,
  signed_json    jsonb not null,
  network        text not null default 'devnet',
  indexed_at     timestamptz default now()
);
create index idx_cnft_content_hash on cnft_assets(network, content_hash);
```

- `network` カラムでdevnet/mainnetを分離。全クエリにnetworkフィルタ必須。
- RLS有効: SELECT=public, INSERT/UPDATE=service_role only。
- 最小限。将来PDQ特徴量等のクエリ条件が必要になったら `ALTER TABLE ADD COLUMN` で随時追加。

## 差分Pollアルゴリズム

cNFTはimmutable（削除以外変更なし）。新しい方から降順で遡り、既知のasset_idに当たったら打ち切り。

```
for each collection in [core, ext]:
  page = 1
  loop:
    assets = DAS.searchAssets(collection, sortBy=id, desc, page, limit=1000)
    for asset in assets:
      if DB.exists(asset.asset_id) → STOP（既知地点到達）
      signed_json = fetch(asset.json_uri)
      content_hash = asset.attributes["content_hash"]
      processor_id = asset.attributes["extension_id"] || "core-c2pa"
      UPSERT into cnft_assets
    if assets.length < 1000 → STOP（最終ページ）
    page++
```

- 毎回最新からスタート → 既知に当たったら終了 → 差分だけ処理
- Webhook取りこぼしも次回Pollで必ず補完
- asset_id PK でUPSERT → 冪等

## 実装状況

### 完了

- [x] Supabase `cnft_assets` テーブル作成（network, RLS設定済み）
- [x] 差分Pollロジック (`web/lib/server/cnft-indexer.ts`)
- [x] 初回バックフィル完了（Core 1122 + Ext 248 = 1370件）
- [x] Helius webhook受信エンドポイント (`/api/v1/webhooks/helius`)
- [x] content_hashクエリAPI (`/api/v1/indexer/content/[contentHash]`)
- [x] Web検証ページをインデクサ経由に切り替え（`helius.ts` 削除 → `indexer.ts`）
- [x] バックフィルスクリプト (`web/scripts/backfill.ts`)

### 残タスク

- [ ] Vercel Cron設定（差分Pollの定期実行）
- [ ] Helius webhook登録（Heliusダッシュボードでエンドポイント設定）
- [ ] 本番デプロイ確認

## ファイル構成

```
web/
  lib/server/cnft-indexer.ts          — コアロジック（Poll, インデックス, クエリ）
  lib/verify/resolvers/indexer.ts     — ContentResolver実装（Supabase経由）
  lib/verify/resolvers/helius.ts      — 削除済み（DAS直接検索）
  lib/verify/content-resolver.ts      — IndexerContentResolverに差し替え済み
  app/api/v1/indexer/poll/route.ts    — 差分Pollエンドポイント
  app/api/v1/indexer/content/[contentHash]/route.ts — クエリエンドポイント
  app/api/v1/webhooks/helius/route.ts — Webhook受信
  scripts/backfill.ts                 — 手動バックフィル/差分Poll実行
supabase/
  migrations/20260407_create_cnft_assets.sql
  migrations/20260407_add_network_to_cnft_assets.sql
```

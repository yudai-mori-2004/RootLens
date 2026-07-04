# 02. Web API 簡素化（mint / TP / Pipeline 2 関連エンドポイント撤去）

## 目的

サーバの REST API を v0.1.4 の最小形に削る。 `POST /api/clips` の必須フィールドを `signatureHash` /
`contentSize` / `network` だけに絞り、 cNFT mint / TP / Pipeline 2 関連のエンドポイントを完全削除する。

## 読むべきファイル

- `document/v0.1.4/DATA_SPECS_JA.md` §2.5（POST /api/clips の v0.1.4 仕様）
- `web/app/api/clips/route.ts`（POST /api/clips、 createSchema を簡素化）
- `web/app/api/clips/[id]/route.ts`（GET、 ClipDto を簡素化）
- `web/app/api/clips/[id]/finalize/route.ts` → **削除**
- `web/app/api/clips/[id]/stake/route.ts` → **削除**
- `web/app/api/clips/[id]/retry/route.ts` → **削除**
- `web/app/api/v1/tp-process/`（存在するなら）→ **削除**
- `web/app/api/v1/tp-mint-tx/`（存在するなら）→ **削除**
- `web/app/api/v1/raw-uploads/route.ts`（**維持**、 ただし signed-json 関連を返さない形に）
- `web/lib/r2.ts` / `web/lib/r2-keys.ts`（signed-json/ プレフィックス削除）
- `web/lib/mapper.ts`（ClipDto から quality_vector / rootAssetId / signedJsonUri / processing_step 等を削除）
- `web/shared/api-types.ts`（ClipDto / CreateClipRequest / ProcessingStep / Layer1-3Score 等を整理）

## スコープ

### やること

1. **POST /api/clips**: createSchema を `signatureHash` / `contentSize` / `network` の 3 つだけに。
   `rootAssetId` / `signedJsonUri` の zod 必須を外す。 重複排除キーは `(wallet, signatureHash, network)` のまま。
2. **GET /api/clips/:id** / **GET /api/clips**: ClipDto から削除済み列を全部撤去。
3. **削除するエンドポイント**: `[id]/finalize`、 `[id]/stake`、 `[id]/retry`、 `v1/tp-process`、
   `v1/tp-mint-tx`、 `v1/tp-mint-callback`（あれば）。 ルートファイルごと削除。
4. **raw-uploads は維持**: 返す `files` map から signed-json は外す。 rgb.mp4 + realtime_handpose.jsonl
   + metadata.json + imu.jsonl (optional) + depth.tar (optional) の 5 種類のみ。
5. **api-types.ts**: `ClipState` を `uploading | uploaded | error` の 3 値に。 `ProcessingStep` /
   `AutoCategory` / `Layer1Score` / `Layer2Score` / `Layer3Score` / `QualityBreakdown` /
   `QualityVector` / `RawSessionFilename` 関連は不要なものを削除。
6. `npx tsc --noEmit`（web）green。

### やらないこと

- v0.1.5 の後段ワーカー用エンドポイント（blur worker callback 等）の先取り実装。
- raw-uploads の signed URL TTL や認証強化（= 別案件）。
- `app/api/clips` 配下の他ルート（例: download / share）にあれば残し、 v0.1.5 でレビュー。

## 成功基準

- 上記 3 エンドポイントが web/app/api 配下から消えている。
- `POST /api/clips` を `signatureHash` / `contentSize` / `network` のみで実行して 201 が返る。
- ClipDto に mint / quality / staking 関連フィールドが無い。
- web 側 tsc green、 Vercel deploy 通過。
- アプリ（task 03 配線後）が新 API でアップロード成功。

## 進捗

- [x] route.ts (POST createSchema) 簡素化（signatureHash + contentSize + recordingConfig + optional 数件）
- [x] finalize / stake / retry / tp-process / tp-mint-tx / tp-proxy 削除
- [x] raw-uploads（files set はそのまま 5 種、 signed-json は元々無し）
- [x] mapper / api-types 整理（ClipDto / CreateClipRequest 簡素化）
- [x] tsc green
- [x] deploy（2026-07-04 main push → Vercel auto deploy。 finalize が 404、 GET /api/clips が
      新 ClipDto (= v0.1.4 フィールドのみ) を返すことを本番で実測確認。 POST の 201 確認は
      task 06 の実機 E2E で行う）

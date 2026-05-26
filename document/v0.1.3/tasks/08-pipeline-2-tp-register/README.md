# タスク 08: Title Protocol register (Root NFT 発行)

## 目的

品質スコアリング (= task 04-07) が完了したクリップを Title Protocol に登録し、 Root NFT (= cNFT) を Solana 上に発行する。 TP は C2PA 署名を TEE 内で検証し、 コンテンツハッシュと cNFT の暗号学的バインディングを確立する。

## 読むべきファイル

### 仕様
1. `document/v0.1.3/DATA_SPECS_JA.md` §3.4 Title Protocol 登録

### v0.1.2 流用元 (ADAPTABLE)
2. `server/lib/tp.ts` (125 行) ─ TitleClient.register 呼び出し、 dynamic import (= WDK ESM only sandbox 制約) パターン、 SDK 戻り値 schema バージョン揺れ対応 (L104-122)
3. `server/workflow/process-clip.ts` L62-70 ─ tp-submit step の使い方

### Title Protocol SDK
4. `@title-protocol/sdk` ─ TitleClient.register の API
5. (隣接プロジェクト) `/Users/forest/WebCreations/title-protocol/docs/v0.1.2/SPECS_JA.md` ─ TP 側仕様、 特にリクエスト形式 + 暗号化オプション

## スコープ

### やること

1. **web/lib/tp.ts**: v0.1.2 の `submitToTp()` を port + 以下を更新:
   - R2 download 元バケットを `R2_BUCKET_BLURRED` → `R2_BUCKET_RAW` に
   - R2 key を `blurredMp4Key(contentHash)` → `signedMp4Key(contentId)` に
   - `processorIds: ["core-c2pa"]` は維持 (= TP 側で C2PA 検証を走らせる)
   - `extensionInputs: {"rootlens-license-v1": {tos_version, tos_hash}}` も維持 (= ToS 紐付け)
   - 戻り値: `rootAssetId` + `signedJsonUri` (= clips テーブルの該当カラムに保存)

2. **WDK workflow step**: task 03 で TODO だった `tp-submit` step を実装:
   ```ts
   const tpResult = await tpSubmitStep({
     clipId,
     contentId,
     ownerWallet,
     tosVersion: process.env.ROOTLENS_TOS_VERSION!,
     tosHash: process.env.ROOTLENS_TOS_HASH!,
   });
   // DB 更新: rootAssetId + signedJsonUri + datasetPrefix (= datasets/<rootAssetId>/) を埋める
   ```

3. **冪等性**: TP register は重複登録を防ぐため、 既に rootAssetId が DB にあれば短絡 (= TP 呼び出しスキップ、 既存値を返す)

### やらないこと

- License NFT 発行 (= v0.1.2 で実装済の Solana program、 staking 後に AI 企業が叩く)
- Bubblegum delegate (= task 03 の stake endpoint で別途)
- TP 側 C2PA 検証ロジック (= TP TEE 内で完結)
- ToS 同意ログ (= 別 task で port、 tos_consents テーブル既存)

## 成功基準

- [ ] devnet 環境で TP register が成功し、 `rootAssetId` が `solana_*` 形式の base58 文字列で返る
- [ ] 同 clipId に対する 2 回目以降の workflow 実行で TP 呼び出しがスキップされる (= 冪等性)
- [ ] DB の clips 行に `rootAssetId`、 `signedJsonUri`、 `datasetPrefix` が書き込まれる
- [ ] `ROOTLENS_TOS_VERSION` / `ROOTLENS_TOS_HASH` 未設定で fail-loud
- [ ] R2 raw バケットの key が正しく presigned download URL になり TP に渡る
- [ ] 全 5 step (= metadata / frame / vlm / gtsam / tp) 完走で clip state が `ready` に

## 進捗 (2026-05-26) — 設計変更

- 🔄 **本 task は v0.1.3 で廃止**: 新 TP は client-driven (= TP SDK 廃止) で、 mock_device 側で `/process` を直接叩く構造に変更
- ⏳ 次フェーズ: 本 task の内容は `02-pipeline-1-mock-cli` の追加機能として吸収 (= mock_device で `/process` 呼ぶ + cNFT 発行で rootAssetId 確定)
- 削除対象: web/lib/tp.ts、 web/workflow/process-clip.ts の tp-submit step、 `MODAL_BUNDLE_ENDPOINT` 以外の TP 関連 env

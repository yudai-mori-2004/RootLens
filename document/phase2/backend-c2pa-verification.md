# バックエンドC2PA検証の必要性

## 問題

現在の実装では、フロントエンドから送信される`rootSigner`/`rootCertChain`をそのまま信頼している。

### 攻撃シナリオ
```bash
# 攻撃者が /api/upload を直接叩く
curl -X POST /api/upload \
  -d '{
    "rootSigner": "Sony Alpha 1",  # 偽装
    "rootCertChain": "偽の証明書",
    "originalHash": "偽ハッシュ",
    "mediaFilePath": "R2パス"
  }'
```

### 影響
- ❌ RootLens上の表示が騙される（「Sony Alpha 1で撮影」と表示）
- ✅ ダウンロード後にc2pa.read()すれば偽造は発覚
- ⚠️ 検証しないユーザーは気づかない

## 対策

Workerで元ファイルのC2PA検証を実施する。

### 実装方針

```typescript
// worker/src/processor.ts

async function processMint(data: MintJobData) {
  // Step 0: R2から元ファイルをダウンロード
  const fileBuffer = await downloadFromR2(data.mediaFilePath);

  // Step 1: C2PAライブラリで検証
  const manifestStore = await c2pa.read(fileBuffer);

  if (!manifestStore) {
    throw new Error('C2PA検証失敗: マニフェストが見つかりません');
  }

  // Step 2: ハッシュ値の検証
  const extractedHash = extractDataHash(manifestStore);

  if (extractedHash !== data.originalHash) {
    throw new Error('C2PA検証失敗: ハッシュ値が一致しません');
  }

  // Step 3: rootSigner/rootCertChainの再抽出
  const verifiedRootSigner = manifestStore.activeManifest.signatureInfo.issuer;
  const verifiedRootCertChain = extractCertChain(manifestStore);

  // フロントエンドからの値を破棄し、検証済みの値を使用
  const verifiedData = {
    ...data,
    rootSigner: verifiedRootSigner,
    rootCertChain: verifiedRootCertChain,
  };

  // Step 4: Arweaveアップロード（検証済みデータ）
  await uploadToArweave(verifiedData);
}
```

### 必要な実装
1. WorkerでのR2ダウンロード機能
2. Node.js版C2PAライブラリの導入（`@contentauth/toolkit`等）
3. フロントエンドからの値を破棄し、バックエンド検証値を使用

### 優先度
**Phase2で実装**（現在はフロントエンドのみで検証）

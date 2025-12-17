# C2PAデータ仕様変更 - Arweaveメタデータ改善

**日付**: 2025-01-17
**対象**: Arweaveに保存するC2PA証明データの属性

---

## 📋 変更概要

Arweaveに保存する証明データの属性を、より標準的で意味のある情報に変更しました。

### 変更内容

| 項目 | 変更前 | 変更後 | 理由 |
|------|--------|--------|------|
| **削除** | `root_cert_chain` | - | ほとんど含まれないため意味をなさない |
| **追加** | - | `claim_generator` | 撮影デバイス情報（例: "Google Pixel 7 1.0"） |
| **追加** | - | `source_type` | デジタルソースタイプ（ハードウェア署名の証明） |

---

## 🎯 `source_type` の重要性

### IPTC国際標準

`source_type`（正確には`digitalSourceType`）は、**C2PA対応の全てのハードウェアに存在する標準プロパティ**です。

| 値 | 意味 |
|---|---|
| `digitalCapture` | ハードウェアで撮影（現実のシーンをセンサーでサンプリング） |
| `trainedAlgorithmicMedia` | AI生成 |

完全なURI:
- ハードウェア: `http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture`
- AI生成: `http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia`

### メーカー非依存

この値は、**Google Pixel**, **Sony α9 III**, **Leica M11-P**, **Nikon**, **Canon**など、すべてのC2PA対応カメラで共通です。

---

## 🔧 実装内容

### 1. C2PA Parser - `getSourceType` 関数追加

**ファイル**: `frontend/app/lib/c2pa-parser.ts`

```typescript
/**
 * マニフェストから source_type (digitalSourceType) を抽出する関数
 * @returns "digitalCapture" | "trainedAlgorithmicMedia" | null
 */
export function getSourceType(manifest: Manifest): string | null {
  if (!manifest.assertions || !('data' in manifest.assertions)) {
    return null;
  }

  const actionAssertion = manifest.assertions.data.find((a: Assertion) =>
    a.label === 'c2pa.actions' || a.label === 'c2pa.actions.v2'
  );

  if (!actionAssertion) return null;

  const data = actionAssertion.data as any;
  const actionsList = data.actions;

  if (!Array.isArray(actionsList)) return null;

  for (const action of actionsList) {
    if (action.digitalSourceType) {
      const typeUri = action.digitalSourceType as string;

      if (typeUri === "http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture") {
        return "digitalCapture";
      }

      if (typeUri.includes("trainedAlgorithmicMedia")) {
        return "trainedAlgorithmicMedia";
      }

      return typeUri;
    }
  }

  return null;
}
```

**データの場所**: `manifest.assertions.data → c2pa.actions → digitalSourceType`

---

### 2. 型定義の更新

**ファイル**: `shared/types/job.ts`

```typescript
export interface MintJobData {
  userWallet: string;
  originalHash: string;
  rootSigner: string;
  claimGenerator: string;      // 追加
  sourceType: string;           // 追加
  // rootCertChain: string;     // 削除
  mediaFilePath: string;
  thumbnailPublicUrl?: string;
  price: number;
  title?: string;
  description?: string;
  mediaProofId?: string;
}
```

---

### 3. Workerのアップロード処理更新

**ファイル**: `worker/src/lib/arweave.ts`

```typescript
export async function uploadToArweave(data: {
  originalHash: string;
  rootSigner: string;
  claimGenerator: string;      // 追加
  sourceType: string;           // 追加
  // rootCertChain: string;     // 削除
  predictedAssetId: string;
  thumbnailPublicUrl?: string;
}): Promise<string> {
  const proofMetadata: ArweaveProofMetadata = {
    name: `RootLens Proof #${data.originalHash.slice(0, 8)}`,
    symbol: 'RLENS',
    description: 'Media authenticity proof verified by RootLens',
    target_asset_id: data.predictedAssetId,
    attributes: [
      { trait_type: 'original_hash', value: data.originalHash },
      { trait_type: 'root_signer', value: data.rootSigner },
      { trait_type: 'claim_generator', value: data.claimGenerator },  // 追加
      { trait_type: 'source_type', value: data.sourceType },          // 追加
      // { trait_type: 'root_cert_chain', value: data.rootCertChain }, // 削除
      { trait_type: 'created_at', value: new Date().toISOString() },
    ],
  };

  // Irysタグにもsource_typeを追加
  const file = createGenericFileFromJson(proofMetadata, 'metadata.json', {
    contentType: 'application/json',
    tags: [
      { name: 'original_hash', value: data.originalHash },
      { name: 'source_type', value: data.sourceType },  // 追加
      { name: 'App-Name', value: 'RootLens' },
    ]
  });

  const [metadataUri] = await umi.uploader.upload([file]);
  return metadataUri;
}
```

**ファイル**: `worker/src/processor.ts`

```typescript
const arweaveUri = await uploadToArweave({
  originalHash: data.originalHash,
  rootSigner: data.rootSigner,
  claimGenerator: data.claimGenerator,  // 追加
  sourceType: data.sourceType,          // 追加
  // rootCertChain: data.rootCertChain,  // 削除
  predictedAssetId,
  thumbnailPublicUrl: data.thumbnailPublicUrl,
});
```

---

### 4. フロントエンドのアップロード処理更新

**ファイル**: `frontend/app/[locale]/upload/page.tsx`

```typescript
// claimGenerator と sourceType を抽出
const claimGenerator = summaryData?.activeManifest?.claimGenerator || 'Unknown';

// getSourceType関数を使ってsourceTypeを抽出
let sourceTypeShort = 'unknown';
if (manifestData?.activeManifest) {
  const extractedSourceType = getSourceType(manifestData.activeManifest);
  if (extractedSourceType) {
    sourceTypeShort = extractedSourceType;
  }
}

console.log('📋 claimGenerator:', claimGenerator);
console.log('📋 sourceType:', sourceTypeShort);

// アップロードAPI呼び出し
const uploadResponse = await fetch('/api/upload', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    userWallet: solanaWallet.address,
    originalHash: hashes.originalHash,
    rootSigner: summaryData?.activeManifest?.signatureInfo?.issuer || 'Unknown',
    claimGenerator: claimGenerator,      // 追加
    sourceType: sourceTypeShort,         // 追加
    // rootCertChain: rootCertChain,     // 削除
    mediaFilePath: `media/${hashes.originalHash}/original.${getExtension(currentFile.type)}`,
    thumbnailPublicUrl: publicUploadResult.thumbnail_url,
    price: Math.floor(parseFloat(priceStr || '0') * 1e9),
    title: title || undefined,
    description: description || undefined,
    mediaProofId: mediaProofId,
  }),
});
```

**削除した関数**: `extractRootCertChain()` - もう不要なため削除

---

## 📊 変更後のArweaveメタデータ例

```json
{
  "name": "RootLens Proof #abc123ef",
  "symbol": "RLENS",
  "description": "Media authenticity proof verified by RootLens",
  "image": "https://pub-xxxxx.r2.dev/media/abc123.../thumbnail.jpg",
  "target_asset_id": "7xKp...3mNv",
  "attributes": [
    { "trait_type": "original_hash", "value": "abc123ef..." },
    { "trait_type": "root_signer", "value": "Google LLC" },
    { "trait_type": "claim_generator", "value": "Google Pixel 7 1.0" },
    { "trait_type": "source_type", "value": "digitalCapture" },
    { "trait_type": "created_at", "value": "2025-01-17T12:00:00Z" }
  ]
}
```

---

## ✅ 利点

### 1. **メーカー非依存の検証**

`source_type === "digitalCapture"` をチェックするだけで、どのメーカーのカメラでもハードウェア署名であることを確認できます。

### 2. **Irys GraphQLでの検索性向上**

```graphql
query {
  transactions(
    tags: [
      { name: "source_type", values: ["digitalCapture"] }
    ]
  ) {
    edges {
      node {
        id
      }
    }
  }
}
```

ハードウェア署名の証明のみをタグ検索で効率的に取得可能。

### 3. **デバイス情報の記録**

`claim_generator`により、撮影デバイスの詳細情報（モデル名、バージョン）が記録されます。

### 4. **データサイズの削減**

`root_cert_chain`（1-3KB）を削除し、短い文字列（`claim_generator`, `source_type`）に置き換えることで、Arweaveストレージコストを削減。

---

## 🔍 検証方法

### フロントエンドでの確認

ブラウザのコンソールに以下のログが出力されます:

```
📋 claimGenerator: Google Pixel 7 1.0
📋 sourceType: digitalCapture
```

### Arweave Explorer での確認

1. Irys Explorer で Arweave TX を開く
2. `attributes` 配列に以下が含まれることを確認:
   - `claim_generator`
   - `source_type`
3. `tags` に `source_type` タグが含まれることを確認

---

## 🚀 今後の活用

### 1. デバイス別統計

Arweaveタグから`source_type === "digitalCapture"`でフィルタリングし、`claim_generator`別の統計を取得可能。

### 2. AI検出

`source_type === "trainedAlgorithmicMedia"`を検出し、AI生成コンテンツを自動的に除外可能。

### 3. 信頼性スコアリング

特定のデバイス（`claim_generator`）の証明数や品質に基づいて、信頼性スコアを算出可能。

---

## 📝 互換性

### 既存データへの影響

**既存のArweaveデータ**: 変更なし（immutable）
**新規アップロード**: 新しい仕様を使用

既存の証明書ページは引き続き機能します（`root_signer`と`created_at`のみ使用しているため）。

---

## 🔗 関連ドキュメント

- [IPTC Digital Source Type](http://cv.iptc.org/newscodes/digitalsourcetype/)
- [C2PA Technical Specification](https://c2pa.org/specifications/)

---

## ✨ まとめ

この変更により、RootLensのC2PA検証データは:
- ✅ より標準的
- ✅ よりコンパクト
- ✅ より検索しやすく
- ✅ メーカー非依存

になりました。

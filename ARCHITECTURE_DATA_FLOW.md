# RootLens Ver4 - データフロー完全設計書

## 📊 概要

RootLensは、C2PA署名付きメディアファイルの真正性を証明するプラットフォームです。
この設計書では、ユーザーがファイルをアップロードしてから、購入者が検証するまでの全データフローを定義します。

---

## 1️⃣ クライアント側の処理（ブラウザ）

### Input: ユーザーがアップロードするファイル

```javascript
File {
  name: "sony_photo.jpg",
  size: 5242880,  // 5MB
  type: "image/jpeg"
}
```

このファイルには、カメラやソフトウェアによってC2PAメタデータが埋め込まれています。

---

### 処理A: C2PA Manifest読み取り

```javascript
const c2pa = await createC2pa();
const { manifestStore } = await c2pa.read(file);

// manifestStoreの構造
{
  activeManifest: {
    claim_generator: "Sony ILCE-7M4 1.0",
    signature_info: {
      issuer: "Sony Corporation",
      cert_chain: [
        "-----BEGIN CERTIFICATE-----\nMIIDbTCC...",  // Root CA
        "-----BEGIN CERTIFICATE-----\nMIIEkjCC...",  // Intermediate CA
        "-----BEGIN CERTIFICATE-----\nMIIFazCC..."   // End-Entity
      ],
      time: "2024-12-01T15:30:00Z"
    },
    assertions: [
      {
        label: "stds.exif",
        data: {
          "exif:Make": "Sony",
          "exif:Model": "ILCE-7M4",
          "exif:DateTime": "2024:12:01 15:30:00",
          "exif:GPSLatitude": "35,40,34.32N",
          "exif:GPSLongitude": "139,39,1.08E",
          "exif:FNumber": "2.8",
          "exif:ISO": "800"
        }
      },
      {
        label: "stds.iptc",
        data: {
          "Caption": "富士山の夕焼け",
          "Creator": "Photographer Name",
          "Copyright": "© 2024 ..."
        }
      },
      {
        label: "creative.thumbnail",
        data: "data:image/jpeg;base64,/9j/4AAQ..."  // 50-200KB
      }
    ]
  }
}
```

**サイズ**: 50-500KB

---

### 処理B: ファイルハッシュ計算

```javascript
const buffer = await file.arrayBuffer();
const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
const originalHash = Array.from(new Uint8Array(hashBuffer))
  .map((b) => b.toString(16).padStart(2, '0'))
  .join('');

// 結果例
// "17c9e5b9f40ef79bb8e8af4adf36fe2be54d9c4a7f96f29813e6c3850ab8caa8"
```

**サイズ**: 64文字（32バイト）

---

### 処理C: Root署名者と証明書チェーンの抽出

```javascript
// 最初のManifestまで遡る（編集履歴がある場合）
let currentManifest = manifestStore.activeManifest;
while (currentManifest.ingredients?.length > 0) {
  currentManifest = currentManifest.ingredients[0].c2pa_manifest;
}

// Root署名者を取得
const rootSigner = currentManifest.signature_info.issuer;
// 例: "Sony Corporation"

// Root証明書チェーンを取得
const rootCertChain = currentManifest.signature_info.cert_chain;
// [PEM形式の証明書配列]

// Base64エンコード
const rootCertChainBase64 = btoa(JSON.stringify(rootCertChain));
```

**rootSigner サイズ**: 50-100 bytes
**rootCertChainBase64 サイズ**: 1-3KB

---

### 処理D: サーバーへ送信

```javascript
// POST /api/upload
{
  userWallet: "FDpZZq5URiLVfnnaotqmewMaBLR7aXw3Gq4DTg518jGA",
  originalHash: "17c9e5b9f40ef79bb8e8af4adf36fe2be54d9c4a7f96f29813e6c3850ab8caa8",
  rootSigner: "Sony Corporation",
  rootCertChain: "W1siLS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0...",
  mediaFilePath: "media/17c9e5b9.../original.jpg",
  price: 1000000000,  // 1 SOL in lamports
  title: "富士山の夕焼け",
  description: "2024年12月1日撮影"
}
```

---

## 2️⃣ R2（Cloudflare R2）

### ストレージ構造

```
media/{originalHash}/
├── original.jpg          # 元ファイル（5MB）
└── manifest.json         # C2PA ManifestStore全体（50-500KB）
```

### original.jpg

- **内容**: ユーザーがアップロードした元ファイル
- **サイズ**: 可変（数MB〜数百MB）
- **アクセス**: Presigned URL（購入者のみ、期限付き）
- **用途**: 販売対象、購入後の検証用
- **削除可能**: はい（GDPR対応、違法コンテンツ削除）

### manifest.json

```json
{
  "activeManifest": {
    "claim_generator": "Sony ILCE-7M4 1.0",
    "signature_info": {
      "issuer": "Sony Corporation",
      "cert_chain": ["-----BEGIN CERTIFICATE-----...", ...],
      "time": "2024-12-01T15:30:00Z"
    },
    "assertions": [
      {
        "label": "stds.exif",
        "data": { "exif:Make": "Sony", "exif:Model": "ILCE-7M4", ... }
      },
      {
        "label": "stds.iptc",
        "data": { "Caption": "富士山の夕焼け", ... }
      },
      {
        "label": "creative.thumbnail",
        "data": "data:image/jpeg;base64,/9j/4AAQ..."
      }
    ]
  }
}
```

- **内容**: C2PA ManifestStore全体（すべてのメタデータ）
- **サイズ**: 50-500KB
- **アクセス**: Presigned URL（購入者のみ）
- **用途**: 購入後のC2PA完全検証
- **削除可能**: はい（GDPR対応、違法コンテンツ削除）

**含まれる情報**:
- EXIF（カメラ設定、GPS、撮影日時等）
- IPTC（タイトル、著作権、クレジット等）
- サムネイル画像（50-200KB）
- 証明書チェーン
- 署名情報
- 編集履歴（ingredients）

---

## 3️⃣ Arweave（Irys経由）

### 保存データ構造

```json
{
  "name": "RootLens Proof #17c9e5b9",
  "symbol": "RLENS",
  "description": "Media authenticity proof verified by RootLens",
  "target_asset_id": "ByVK782kKHEfKjvGq8RMGvz7TJkVXfh1G3LcYZ9PqR3o",
  "attributes": [
    {
      "trait_type": "original_hash",
      "value": "17c9e5b9f40ef79bb8e8af4adf36fe2be54d9c4a7f96f29813e6c3850ab8caa8"
    },
    {
      "trait_type": "root_signer",
      "value": "Sony Corporation"
    },
    {
      "trait_type": "root_cert_chain",
      "value": "W1siLS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tXG5NSUlEYlRDQ0FsV2dBd0lCQWdJQkFqQU5CZ2txaGtpRzl3MEJBUXNGQURB..."
    },
    {
      "trait_type": "created_at",
      "value": "2025-01-15T12:00:00Z"
    }
  ]
}
```

### フィールド詳細

| フィールド | 内容 | サイズ | 用途 |
|-----------|------|--------|------|
| `name` | 証明書の名前 | 50 bytes | 識別用 |
| `symbol` | シンボル（RLENS） | 10 bytes | 識別用 |
| `description` | 説明文 | 100 bytes | 説明 |
| `target_asset_id` | cNFTアドレス | 44 bytes | 相互リンク検証 |
| `original_hash` | 元ファイルのSHA-256 | 64 bytes | ファイル検証 |
| `root_signer` | Root CA名（例: "Sony Corporation"） | 50-100 bytes | 署名者表示・検索 |
| `root_cert_chain` | 証明書チェーン（Base64） | 1-3 KB | C2PA署名検証 |
| `created_at` | タイムスタンプ | 30 bytes | 発行日時 |

**合計サイズ**: 3-5KB
**コスト**: 約0.01円
**アクセス**: 完全公開（誰でも読み取り可能）
**削除**: 不可能（永久保存）

### Arweave URI

```
https://gateway.irys.xyz/{txId}
```

このURIからJSONデータを取得できます。

### 発行者の証明

Irysトランザクション情報（`https://devnet.irys.xyz/tx/{txId}`）を確認すると、`address`フィールドにRootLensサーバーのウォレットアドレスが記録されています。これにより、正規のRootLensから発行されたことが証明できます。

---

## 4️⃣ cNFT（Solana Compressed NFT）

### On-chainデータ

```javascript
{
  leafOwner: "FDpZZq5URiLVfnnaotqmewMaBLR7aXw3Gq4DTg518jGA",
  leafDelegate: null,
  nonce: 0,
  dataHash: "abc123...",
  creatorHash: "def456..."
}
```

### Metadata（Arweaveから取得）

```javascript
{
  name: "RootLens Proof #17c9e5b9",
  symbol: "RLENS",
  uri: "https://gateway.irys.xyz/abc123...",
  sellerFeeBasisPoints: 0,
  collection: null,
  creators: []
}
```

### フィールド詳細

| フィールド | 内容 | 保存場所 | 用途 |
|-----------|------|---------|------|
| `leafOwner` | NFT所有者ウォレットアドレス | On-chain | 所有権証明 |
| `uri` | ArweaveのURI | On-chain | 相互リンク検証 |
| `name` | 証明書名 | Off-chain (Arweave) | 表示 |
| `symbol` | シンボル | Off-chain (Arweave) | 表示 |

**コスト**: 約0.001 SOL
**転送**: 可能（NFTとして）
**Burn**: 可能（is_burned フラグで管理）

### Asset ID

cNFTのユニークID。以下の式で事前計算されます：

```
Asset ID = findLeafAssetIdPda(merkleTree, leafIndex)
```

例: `ByVK782kKHEfKjvGq8RMGvz7TJkVXfh1G3LcYZ9PqR3o`

---

## 5️⃣ Supabase（PostgreSQL）

### media_proofs テーブル

```sql
{
  id: "550e8400-e29b-41d4-a716-446655440000",

  -- チェーン連携
  arweave_tx_id: "abc123def456...",
  cnft_mint_address: "ByVK782kKHEfKjvGq8RMGvz7TJkVXfh1G3LcYZ9PqR3o",
  owner_wallet: "FDpZZq5URiLVfnnaotqmewMaBLR7aXw3Gq4DTg518jGA",

  -- R2パス導出用
  original_hash: "17c9e5b9f40ef79bb8e8af4adf36fe2be54d9c4a7f96f29813e6c3850ab8caa8",
  file_extension: "jpg",

  -- ビジネスデータ
  price_lamports: 1000000000,
  title: "富士山の夕焼け",
  description: "2024年12月1日撮影",

  -- 状態管理
  is_burned: false,
  is_deleted: false,

  -- タイムスタンプ
  created_at: "2025-01-15T12:00:00Z",
  updated_at: "2025-01-15T12:00:00Z"
}
```

### フィールド詳細

| フィールド | 用途 | 理由 |
|-----------|------|------|
| `arweave_tx_id` | Arweaveリンク | すべての証明データを取得するための参照 |
| `cnft_mint_address` | cNFTリンク | 所有権・転送管理 |
| `owner_wallet` | 現在の所有者 | 販売・転送管理 |
| `original_hash` | パス導出・検索 | R2パス導出（media/{hash}/original.{ext}）、重複チェック |
| `file_extension` | パス導出 | Presigned URL生成に必要（media/{hash}/original.{ext}） |
| `price_lamports` | 販売価格 | ビジネスロジック |
| `title` | 表示用タイトル | SEO・UX |
| `description` | 説明文 | SEO・UX |
| `is_burned` | Burn状態 | NFTがBurnされたか |
| `is_deleted` | 削除状態 | 違法コンテンツ等で削除されたか |

### 設計思想

すべての証明データはArweaveに保存されています。Supabaseはビジネスロジック専用です。

**取得方法**:
- `root_signer`: Arweaveから取得
- `manifest_file_path`: original_hashから導出（`media/{original_hash}/manifest.json`）
- `license_type`: manifest.jsonから取得
- `file_format`, `file_size`: manifest.jsonから取得

**検索**: Arweave/cNFT Indexerを使用（Supabaseは補助的）

---

## 📋 データフロー全体図

```
┌──────────────────────────────────────────────────────────────┐
│  1. ユーザーがファイルをアップロード                            │
│     sony_photo.jpg (5MB, C2PA埋め込み済み)                    │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│  2. クライアント側で処理（ブラウザ）                            │
│                                                               │
│  A. C2PA読み取り                                              │
│     manifestStore = c2pa.read(file)                          │
│                                                               │
│  B. ハッシュ計算                                              │
│     originalHash = SHA256(file)                              │
│                                                               │
│  C. Root情報抽出                                              │
│     rootSigner, rootCertChain                                │
│                                                               │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│  3. R2にアップロード（Presigned URL経由）                      │
│                                                               │
│  media/17c9e5b9.../                                          │
│  ├── original.jpg (5MB)                                      │
│  └── manifest.json (50-500KB)                                │
│                                                               │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│  4. サーバーに送信（POST /api/upload）                         │
│                                                               │
│  Job submission → BullMQ → Redis                             │
│                                                               │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│  5. Worker処理（6ステップ）                                    │
│                                                               │
│  Step 1: 既存チェック（重複確認）                              │
│  Step 2: 次のcNFT Asset ID予測                                │
│  Step 3: Arweaveにアップロード（Irys経由）                     │
│  Step 4: cNFT Mint                                            │
│  Step 5: 予測検証                                             │
│  Step 6: Supabaseに保存                                       │
│                                                               │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│  6. 完了                                                      │
│                                                               │
│  ✅ R2: 元ファイル + manifest.json                             │
│  ✅ Arweave: 証明データ（3-5KB）                               │
│  ✅ cNFT: 所有権 + Arweave URI                                 │
│  ✅ Supabase: ビジネスデータ                                   │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

---

## 🔍 検証フロー

### 証明書ページ（無料・公開）

```typescript
// 1. Supabaseから基本情報取得
const proof = await supabase
  .from('media_proofs')
  .select('arweave_tx_id, cnft_mint_address, title, price_lamports')
  .eq('cnft_mint_address', assetId)
  .single();

// 2. Arweaveから証明データ取得
const arweaveData = await fetch(
  `https://gateway.irys.xyz/${proof.arweave_tx_id}`
).then(r => r.json());

// 3. cNFTメタデータ取得
const cnft = await getAsset(proof.cnft_mint_address);

// 4. 相互リンク検証
const isValid =
  arweaveData.target_asset_id === proof.cnft_mint_address &&
  cnft.content.json_uri.includes(proof.arweave_tx_id);

// 5. 表示
console.log(`
  Original Hash: ${arweaveData.attributes.find(a => a.trait_type === 'original_hash').value}
  Root Signer: ${arweaveData.attributes.find(a => a.trait_type === 'root_signer').value}
  Created At: ${arweaveData.attributes.find(a => a.trait_type === 'created_at').value}
  Owner: ${cnft.ownership.owner}
  Price: ${proof.price_lamports / 1e9} SOL
`);
```

**特徴**:
- Arweave + cNFT相互リンクで改ざん検知
- ダウンロード不要（軽量）
- 完全分散型

---

### 購入後（完全検証）

```typescript
// 1. R2から元ファイルをダウンロード（Presigned URL）
const originalFile = await fetch(presignedUrl).then(r => r.blob());

// 2. ハッシュ計算
const buffer = await originalFile.arrayBuffer();
const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
const calculatedHash = Array.from(new Uint8Array(hashBuffer))
  .map(b => b.toString(16).padStart(2, '0'))
  .join('');

// 3. Arweaveのoriginal_hashと照合
const arweaveHash = arweaveData.attributes.find(
  a => a.trait_type === 'original_hash'
).value;

assert(calculatedHash === arweaveHash);  // ✅ ファイルが改ざんされていない

// 4. C2PA検証
const c2pa = await createC2pa();
const { manifestStore } = await c2pa.read(originalFile);

// 5. root_signerを直接抽出
const actualRootSigner = manifestStore.activeManifest.signature_info.issuer;
const arweaveRootSigner = arweaveData.attributes.find(
  a => a.trait_type === 'root_signer'
).value;

assert(actualRootSigner === arweaveRootSigner);  // ✅ 署名者が一致

// 6. 証明書チェーン検証
const actualCertChain = manifestStore.activeManifest.signature_info.cert_chain;
const arweaveCertChainBase64 = arweaveData.attributes.find(
  a => a.trait_type === 'root_cert_chain'
).value;
const arweaveCertChain = JSON.parse(atob(arweaveCertChainBase64));

assert(JSON.stringify(actualCertChain) === JSON.stringify(arweaveCertChain));  // ✅ 証明書チェーン一致
```

**特徴**:
- 元ファイルから直接検証
- C2PAファイル自体に署名が埋め込まれているため完全トラストレス
- サーバーの改ざんも検出可能

---

## 🔐 信頼構造

### レイヤー1: アップロード時（瞬間的なサーバー信頼）

```
クライアント → RootLensサーバー → Arweave/cNFT
                     ↑
                 この瞬間のみ信頼
```

サーバーが悪意を持っている場合、以下が可能です：
- 別のファイルのハッシュを保存
- 別のroot_signerを保存

**しかし**、この行為は購入後の検証で必ず検出されます。

---

### レイヤー2: Arweave書き込み後（完全改ざん不可）

```
Arweave（ブロックチェーン）
  ↓
誰も変更できない（RootLensも不可）
永久保存
```

一度Arweaveに書き込まれると、誰も変更できません。

---

### レイヤー3: C2PAによる保護

```
sony_photo.jpg
├─ 画像データ
└─ C2PA Manifest（埋め込み）
    ├─ Root Signer: "Sony Corporation"
    ├─ 証明書チェーン: [Sony Root CA, ...]
    ├─ 署名: Sonyの秘密鍵で署名
    └─ ハッシュ: 画像データのハッシュ
```

**C2PA署名はファイルに埋め込まれています**。

サーバーが偽の`root_signer`をArweaveに保存しても：
1. 購入者がファイルをダウンロード
2. C2PA検証を実行
3. ファイル内の`root_signer`と不一致が検出される
4. 詐欺が発覚

**変更するにはSonyの秘密鍵が必要（RootLensには不可能）**

---

### まとめ

| フェーズ | 信頼レベル | 理由 |
|---------|-----------|------|
| アップロード時 | サーバーを信頼 | クライアントがサーバーに処理を委託 |
| Arweave書き込み後 | 完全改ざん不可 | ブロックチェーンで保護 |
| 証明書ページ | 相互リンク検証 | Arweave + cNFTで改ざん検知 |
| 購入後 | 完全トラストレス | C2PAファイル自体に真実が埋め込まれている |

**結論**:
アップロード時のみサーバーを信頼しますが、その後の改ざんは不可能です。
また、C2PAの設計により、購入後は完全にトラストレスな検証が可能です。

---

## 📊 データサイズ・コスト比較

| 保存場所 | データ | サイズ | コスト | 削除可能 | 公開 |
|---------|--------|--------|--------|---------|------|
| R2 | original.jpg | 5MB | $0.015/GB/月 | ✅ | ❌ |
| R2 | manifest.json | 50-500KB | $0.015/GB/月 | ✅ | ❌ |
| Arweave | 証明データ | 3-5KB | ~0.01円（永久） | ❌ | ✅ |
| cNFT | メタデータ参照 | ~100 bytes | ~0.001 SOL | ❌ | ✅ |
| Supabase | ビジネスデータ | ~200 bytes | 無料枠内 | ✅ | 条件付き |

---

## 🎯 設計の合理性

### データの役割分担

1. **R2**: 実物データ（販売対象、削除可能、プライバシー保護）
2. **Arweave**: 証明データ（永久保存、改ざん不可、最小限）
3. **cNFT**: 所有権（転送可能、ブロックチェーン）
4. **Supabase**: ビジネスデータ（価格、タイトル、状態管理）

### 信頼モデル

- **証明書ページ**: 相互リンク検証 + サーバー信頼（部分的）
- **購入後**: C2PAファイル検証により完全トラストレス

### メリット

- **コスト最適化**: Arweave使用量3-5KBのみ
- **プライバシー保護**: GPS等はR2に保存（削除可能）
- **段階的検証**: 無料で概要確認、購入で完全検証
- **GDPR対応**: R2データは削除可能
- **C2PAの力**: ファイル自体に真実が埋め込まれている

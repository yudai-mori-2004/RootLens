# Phase 2: Server-Side C2PA Re-verification Architecture

## 🚨 Current Issue (MVP Limitation)

In the current MVP implementation, the Worker trusts the metadata (`rootSigner`, `claimGenerator`, etc.) sent from the client-side via `/api/upload`.

### Vulnerability
- An attacker could bypass the frontend and hit the API directly.
- They could upload an AI-generated image but send metadata claiming `rootSigner: "Google LLC"`.
- The system would mint a "Verified" cNFT based on false claims.

> **Note:** Even in this scenario, the actual C2PA manifest in the file remains invalid. Anyone downloading and checking the file with `c2pa-rs` would see the fraud. However, the *on-chain record* would incorrectly state it is verified.

---

## 🛠 Phase 2 Solution: Trustless Worker Verification

To resolve this, we will implement server-side verification within the Worker process before minting.

### Architecture

The Worker (`worker/src/processor.ts`) flow will be updated as follows:

1. **Receive Job**: Worker picks up the job from Redis.
2. **Download Source**: Fetch the `original.{ext}` file from the R2 Private Bucket.
3. **Verify Integrity (New Step)**:
   - Use `c2pa-node` (Node.js binding for Rust SDK) to parse the file manifest.
   - **Validate**:
     - Is the `rootSigner` truly "Google LLC" (or trusted issuer)?
     - Is the `signature` valid and untampered?
     - Does the `manifest` match the file content?
4. **Compare & Reject**:
   - Compare the extracted data with the job data sent from the client.
   - **Mismatch?** → Throw error `InvalidProofAttempt`, reject job, ban user wallet.
   - **Match?** → Proceed to Minting.

### Why was this deferred? (Strategic Trade-off)

Implementing `c2pa-node` in a serverless/containerized environment requires complex native dependency management (Rust/Wasm bindings).
For the Hackathon MVP, we prioritized **Asset ID Prediction logic** and **Lens Search** implementation to prove the unique value of the protocol, accepting this temporary centralization risk.

### Technology Stack for Phase 2
- **Library**: `c2pa-node` (Official ContentAuth SDK)
- **Infrastructure**: Custom Docker container for Railway (to support Rust bindings)

> **⚠️ Important Note**: This document describes the **Phase 2.0 (Basic Server Verification)** approach. For the complete **Trustless Architecture using TEE**, see:
>
> 📄 **[Trustless TEE Architecture](./trustless-tee-architecture.md)** (Phase 2.2)
>
> The TEE approach eliminates trust in server operators through AWS Nitro Enclaves, cryptographic attestation, and on-chain policy governance.

---

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

```
# RootLens

> **Proof of Reality, Ownership on Chain**

**RootLens** is a platform that combines C2PA hardware signatures with blockchain technology to redefine and protect the value of "reality" in the AI era.

## 🎬 Demo Video

**Watch the 3-minute pitch:** [RootLens | Proof of Reality Marketplace on Solana](https://youtu.be/d0EfjTB6ceM)

---

## 🎯 One-Liner

**"A platform that gives ownership and liquidity to authentic content captured by hardware"**

---

## 🌍 Why This Project Matters

### The Crisis of Trust in the AI Era

In 2024, generative AI has exploded across images, videos, and audio. Anyone can create "photorealistic" content in seconds.

While this unleashes tremendous creativity, it also creates a serious problem:

> **"We can no longer tell if what we're seeing is real or AI-generated"**

News photos, evidence images, historical records — everything we once "believed when we saw it" is now subject to doubt.

### The Rising Value of Reality

Ironically, AI's advancement has made **"content actually captured by cameras, unaltered reality"** the most valuable.

Yet there's no mechanism to **monetize** that value:

- C2PA-compatible cameras can prove authenticity
- But there's no marketplace to buy/sell content with that proof
- No clear way to establish who owns the rights to that image

---

## 💡 Two Technologies RootLens Combines

### Technology ①: C2PA (Coalition for Content Provenance and Authenticity)

- Compatible cameras (Sony, Nikon, Google Pixel) embed a "digital signature" at hardware level during capture
- This signature is cryptographically protected and **detects tampering**
- **Mathematically proves** "this data was definitely captured by this camera"

**What C2PA alone can achieve:**
- Content authenticity verification
- Tamper detection
- Provenance information preservation

→ These are achievable with Web2 services as well

### Technology ②: Blockchain (Solana + Arweave)

- Links ownership of verified content to wallets
- Enables rights to be **bought/sold as NFTs**
- Prevents hijacking through **mutual linking design**

**Additional value blockchain provides:**
- Clear ownership attribution
- Rights liquidity (buying/selling/transfer)
- Hijacking prevention (mutual linking)

---

## 🔧 Technology Role Division (Important)

| What We Want to Achieve | Technology | Possible with Web2? |
|---|---|---|
| Content authenticity proof | **C2PA** | ✓ Yes |
| Tamper detection | **C2PA** | ✓ Yes |
| Provenance preservation | **C2PA** | ✓ Yes |
| Clear ownership attribution | **Blockchain** | △ DB records possible, but... |
| Rights liquidity (buy/sell/transfer) | **Blockchain** | ✗ Difficult |
| Hijacking prevention | **Blockchain** | ✗ Difficult |

> C2PA alone enables trustless authenticity verification. Blockchain handles "who owns it" and "rights liquidity."

---

## 🚀 Demo Instructions for Judges

### Important Notes Before You Start

This is an **MVP (Minimum Viable Product)** with the following limitations:

#### 1. Hardware Signature Required (C2PA)

RootLens requires **C2PA hardware signatures** for all uploads. This technology is still not widely available:
- **Recently introduced**: Google Pixel 10 (2024)
- **High-end cameras**: Canon, Nikon professional models
- Most people don't have compatible devices yet

**Solution**: We've prepared **sample images with C2PA signatures** in Google Drive:
- [[Sample Images Link](https://drive.google.com/drive/folders/1kGeYKn7g8zuOpqfZJXkmI4iRexAkjvc3?usp=sharing)] ← Please download from here

**⚠️ Important**: Once an image is uploaded, it **cannot be uploaded again** (duplicate hash detection). You may encounter failures due to duplicates. We apologize for the inconvenience.

#### 2. Single Merkle Tree = Sequential Processing

Since this is an MVP, we only created **one Merkle Tree**:
- Uploads are processed **serially** (one by one)
- Each upload waits for the previous one to complete
- If many people access simultaneously, **expect long wait times**
- **Please avoid frequent uploads**

### How to Access the Demo

#### For Mobile Users (Recommended)

1. **Install Phantom Wallet**
   - Download from App Store or Google Play
   - Create a new wallet or use existing one

2. **Switch to Testnet Mode**
   - Settings → Developer Settings
   - Enable "Testnet Mode"
   - Select "Solana Devnet"

3. **Get Devnet SOL (Free)**
   - Visit: https://faucet.solana.com
   - Enter your wallet address
   - Request airdrop (you'll receive test SOL)

4. **Access RootLens from Phantom Browser**
   - Open Phantom app
   - Use the built-in browser
   - Navigate to: [https://www.rootlens.io](https://www.rootlens.io/)

#### For Desktop Users

1. **Install Phantom Browser Extension**
   - Chrome/Brave/Firefox supported
   - Visit: https://phantom.app

2. **Switch to Devnet**
   - Click Phantom icon → Settings → Developer Settings
   - Enable "Testnet Mode" → Select "Devnet"

3. **Get Devnet SOL**
   - Visit: https://faucet.solana.com
   - Request airdrop to your wallet

4. **Access the App**
   - Navigate to: [https://www.rootlens.io](https://www.rootlens.io/)
   - Connect your Phantom wallet

### What You Can Try

1. **Upload** - Submit C2PA-signed images (use our samples)
2. **Verify** - View certificate pages with full provenance
3. **Search** - Use Lens feature (text or image search)
4. **Trade** - Buy/sell verified content with SolanaPay

---

## 🏗️ Technical Architecture

## 🧠 Technical Highlights (Why This Was Hard)

### 🔄 Solving the "Chicken and Egg" Problem with Asset ID Prediction

To create a truly trustless link between the **Storage Layer (Arweave)** and the **Ownership Layer (Solana)**, they must reference each other:

1. The cNFT metadata must point to the Arweave transaction.
2. The Arweave transaction must point to the cNFT Asset ID.

**Problem:** You can't know the cNFT Asset ID until *after* you mint it. But you need the Arweave URI (which contains the Asset ID) *before* you mint. It's a circular dependency.

**Our Solution:**
We implemented a deterministic **Asset ID Prediction Mechanism** directly in the backend worker:

1. **Read Tree State**: Fetch the current `numMinted` from the on-chain Merkle Tree config.
2. **Calculate Leaf Index**: The next leaf index is deterministically `numMinted`.
3. **Derive PDA**: Calculate the future Asset ID using the Program Derived Address (PDA) formula `(tree_address, leaf_index)`.
4. **Commit to Arweave**: Upload the metadata including this *predicted* Asset ID.
5. **Mint**: Execute the mint transaction targeting that exact leaf index.

> **Code Reference:** `worker/src/lib/solana.ts` - `predictNextAssetId()`

This ensures that the immutable record on Arweave contains the correct Solana address before the NFT even exists.

---

### Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Frontend | Next.js 15 (App Router) | React Server Components, unified API |
| Blockchain | Solana (BubbleGum/Metaplex) | Low-cost mass minting with cNFTs |
| Permanent Storage | Arweave (via Irys) | Permanent storage, Umi integration, SOL payment |
| Storage | Cloudflare R2 (2 buckets) | Free egress, Private + Public structure |
| Database | Supabase (PostgreSQL + pgvector) | DB + Vector search |
| C2PA | c2pa-rs (WASM) | Browser-based C2PA verification |
| Auth | Privy | Wallet + SMS authentication |
| Payment | SolanaPay | Direct transfer, minimal fees |
| RPC | Helius | cNFT reading, DAS API |
| Job Queue | BullMQ + Upstash Redis | Serial processing, retry, cloud-native |
| Lens Search | Cloudflare Workers AI | uform-gen2-qwen-500m + bge-base-en-v1.5 |
| i18n | next-intl | Full English/Japanese support |
| Deployment | Vercel + Railway | Separated frontend/worker deployment |

### How It Works

```
1. User uploads C2PA-signed image
   ↓
2. Frontend validates C2PA signature (WASM)
   ↓
3. Job queued in Upstash Redis (BullMQ)
   ↓
4. Worker processes serially:
   - Predicts next cNFT address
   - Uploads to Arweave (with target_asset_id)
   - Mints cNFT (with Arweave URI)
   ↓
5. Mutual linking established:
   Arweave ←→ cNFT
```

### Mutual Linking (Anti-Hijacking)

```
Arweave (Proof Data) ←→ cNFT (Ownership)

• Arweave stores target cNFT address
• cNFT stores Arweave URI
• Both must match for valid proof

→ Copying one side alone is invalid
→ Even if cNFT is burned, Arweave record remains
→ Hijacking is impossible
```

**Real Example on Devnet:**

- **Arweave Proof**: [4rQquUFx1NQsogG82WXkNBXpW8tahuRBVyc1NwM9jGcQ](https://devnet.irys.xyz/4rQquUFx1NQsogG82WXkNBXpW8tahuRBVyc1NwM9jGcQ)
  - Contains `target_asset_id`: `2XPSV8iGSUYRuv2ggGtXCDZ7z9uP2pGVVohNWfbQxDLx`

- **Solana cNFT**: [2XPSV8iGSUYRuv2ggGtXCDZ7z9uP2pGVVohNWfbQxDLx](https://orb.helius.dev/address/2XPSV8iGSUYRuv2ggGtXCDZ7z9uP2pGVVohNWfbQxDLx?cluster=devnet)
  - Metadata URI points to: `https://devnet.irys.xyz/4rQquUFx...`

→ Both records reference each other, creating immutable mutual proof

### ❓ FAQ: What If Asset ID Prediction Fails?

**Q: "If the prediction is wrong or minting fails, won't that create broken links on Arweave?"**

**A: No, the system is designed with resilience in mind.**

Our verification logic uses a **"Search & Match"** approach, not a single-link dependency:

1. **Multiple Records Allowed**: For a given image hash, there can be multiple Arweave records (due to retries, prediction mismatches, etc.)
2. **Smart Verification**: When verifying, the system:
   - Searches for *all* Arweave records matching the original hash
   - Checks each record's `target_asset_id` against Solana
   - Only accepts pairs where **both directions link correctly**
3. **Ghost Records Ignored**: If prediction fails, the Arweave record becomes a "ghost" (points to non-existent cNFT) and is automatically ignored during verification

**Example Scenario:**

```
User uploads image → Worker predicts Asset #100
                   ↓
Case 1 (Success):  Mint creates Asset #100 ✅
                   → Mutual link valid → Verification passes

Case 2 (Failure):  Mint creates Asset #101 instead ❌
                   → Arweave points to #100 (doesn't exist)
                   → This record is ignored

User retries    →  New prediction: Asset #102
                   → Mint creates Asset #102 ✅
                   → New mutual link valid → Verification passes
```

**Why This Works:**
- Solana cNFT minting costs only **$0.00005** per attempt
- Arweave storage is **permanent but cheap** (~$0.0001 per 2KB)
- Failed attempts don't break the system—they're just noise that gets filtered out
- **Eventual consistency**: As long as one valid pair exists, verification succeeds

**Result:** The system prioritizes **trustless verification** over perfect efficiency. Even with occasional prediction mismatches, the mutual linking design ensures only legitimate ownership claims are validated.

> **Implementation:** See `frontend/app/lib/verification-helpers.ts` (verification logic) and `worker/src/lib/verification.ts` (duplicate checking with on-chain validation)

---

## 💰 Cost Efficiency: How Much Does It Cost Per Image?

One of RootLens's key advantages is its **exceptional cost efficiency** for permanent provenance storage.

### Breakdown for a Single High-Quality Image (5MB)

| Component | Cost | Details |
|-----------|------|---------|
| **Solana cNFT Mint** | ~$0.00005 | [Compressed NFT technology](https://www.helius.dev/docs/nfts/nft-compression) enables minting at ~0.0000005 SOL per NFT |
| **Arweave Permanent Storage** | ~$0.0001 | [Only ~2KB JSON metadata](https://irys.xyz/) at $0.05/GB via Irys (not the image itself!) |
| **Solana Transaction Fees** | ~$0.0005 | Standard network fees for Merkle Tree operations |
| **Cloudflare R2 Storage** | ~$0.00008/month | [Original image + thumbnail + manifest](https://developers.cloudflare.com/r2/pricing/) at $0.015/GB-month |
| **Total (One-Time)** | **~$0.00065** | **= 0.065¢ per image for permanent ownership proof** |

### What This Means

- **Hybrid storage design**: Arweave stores immutable proof metadata, R2 stores actual files
- **1,000 images**: ~$0.65 USD one-time + ~$0.08/month for R2
- **100,000 images**: ~$65 USD one-time + ~$8/month for R2 (vs. $74,000+ for traditional NFTs)

### Cost Comparison

| Approach | Per Image Cost | Image Storage | Proof Storage |
|----------|---------------|---------------|---------------|
| **RootLens (cNFT + Hybrid)** | **$0.00065 + $0.00008/mo** | R2 (mutable) | ✅ Arweave (immutable metadata) |
| Traditional Solana NFT | $0.01-0.1 | External URLs | ❌ Not guaranteed |
| Ethereum NFT | $10-100+ | IPFS/Centralized | ❌ High gas fees |
| Web2 Database + S3 | $0.001/month | S3 | ❌ No blockchain proof |

### Why This Design?

**Smart Hybrid Approach:**
1. **Arweave** stores **immutable proof metadata** (~2KB JSON):
   - original_hash, root_signer, claim_generator, source_type, created_at
   - Target cNFT address (mutual linking)
   - Thumbnail URL reference

2. **Cloudflare R2** stores **actual files** (5MB+ images):
   - Zero egress fees for serving images
   - $0.015/GB-month vs. Arweave's $0.05/GB one-time
   - Cost-effective for large files that may need updates (e.g., thumbnails)

3. **Solana cNFT** provides **ownership**:
   - 1000x cheaper than traditional NFTs
   - Links to Arweave metadata URI

### Why So Cheap?

1. **[Compressed NFTs (cNFTs)](https://blog.crossmint.com/compressed-nfts-explained/)**: Reduce minting costs by 1000x
2. **[Smart Data Separation](https://ar-fees.arweave.net/)**: Only immutable proof data on Arweave, images on R2
3. **[Zero Egress Fees](https://www.cloudflare.com/developer-platform/products/r2/)**: Cloudflare R2 eliminates bandwidth costs
4. **Solana's Speed**: Low transaction fees regardless of congestion

> **This hybrid architecture makes mass-scale authentic content registration economically viable—paying only for what needs to be immutable.**

---

## ⚡ Scaling Potential: The "Cashier Lane" Architecture

While the MVP uses a single Merkle Tree, **RootLens can scale linearly by adding more trees**—like opening more cashier lanes at a supermarket.

### Current MVP Performance (1 Merkle Tree)

| Metric | Value | Bottleneck |
|--------|-------|------------|
| **Processing Time** | ~15 seconds/image | Solana transaction confirmation + Arweave upload |
| **Throughput** | ~240 images/hour | Single tree = serial processing (`concurrency: 1`) |
| **Confirmation Level** | `confirmed` | Waiting for block finalization (~400ms) |

**Why Serial?** Each Merkle Tree must process mints sequentially to predict the next leaf index accurately:

```typescript
// worker/src/worker.ts
const worker = new Worker('rootlens-mint-queue', processMint, {
  concurrency: 1,  // ★ One mint at a time per tree
});

// worker/src/lib/cnft.ts
const merkleTree = toPublicKey(process.env.MERKLE_TREE_ADDRESS!);
// ★ Single tree address hardcoded
```

### Linear Scaling: The "Multiple Cashier Lanes" Approach

**Key Insight:** Which Merkle Tree minted a cNFT doesn't matter for verification—just like which cashier lane you used doesn't affect your receipt's validity.

| Merkle Trees | Throughput | Images/Hour | Cost Increase |
|--------------|-----------|-------------|---------------|
| 1 (MVP) | 1x | ~240 | Baseline |
| 5 | 5x | ~1,200 | ~$5 (tree creation only) |
| 10 | 10x | ~2,400 | ~$10 |
| 50 | 50x | ~12,000 | ~$50 |
| 100 | 100x | ~24,000 | ~$100 |

**How It Works:**

```
User Upload Request
        ↓
   Job Queue (Redis)
        ↓
    ┌───┴───┬───────┬───────┐
    ↓       ↓       ↓       ↓
 Tree #1  Tree #2  Tree #3  Tree #4  ... (Load Balanced)
    ↓       ↓       ↓       ↓
  Worker  Worker  Worker  Worker
    ↓       ↓       ↓       ↓
  Arweave  Arweave  Arweave  Arweave
    ↓       ↓       ↓       ↓
  cNFT #1  cNFT #2  cNFT #3  cNFT #4
```

**Implementation Strategy:**

1. **Multiple Tree Deployment**: Create N Merkle Trees on-chain
2. **Worker Pool**: Run N worker instances (or 1 worker with N tree addresses)
3. **Job Router**: Distribute jobs to available trees via Redis queue routing
4. **No Code Changes**: Core verification logic remains identical

### Why This Design Scales

**Each Merkle Tree is Independent:**
- Tree #1 doesn't know or care about Tree #2's state
- Each tree maintains its own sequential leaf index
- cNFT Asset IDs are globally unique (derived from tree address + leaf index)

**Verification is Tree-Agnostic:**
- Mutual linking: Arweave metadata ↔ cNFT Asset ID
- Original hash deduplication checks all trees
- Users don't need to know which tree was used

**Cost-Effective Scaling:**
- Merkle Tree creation: ~$0.50-1 per tree (one-time)
- No per-transaction scaling costs
- Linear throughput increase

> **This architecture enables RootLens to handle 24,000+ images/hour (100 trees) for under $100 in infrastructure costs—making mass adoption economically viable.**

---

## 🌟 Three Values RootLens Provides

### Value ①: Marketplace for Hardware-Verified Content

In an AI-saturated world, content that's **"actually captured by someone who was there, with a real camera"** has scarcity value.

RootLens is the first platform where this value can be priced.

- **News organizations**: Source verified materials for anti-fake news
- **AI companies**: Purchase clean training data with provenance
- **Insurance/Legal**: Use tamper-proof records as evidence

SolanaPay direct transactions minimize platform fees and return value to creators.

### Value ②: Ownership Visualization and Liquidity

Previously, digital content "ownership" was ambiguous.

With RootLens:
- Content rights are **linked to wallets**, attribution is clear
- **Tradable as NFTs** for buying/selling/transfer
- Even if original files leak, **legitimate owners can be identified**

This turns "verified content rights" into a liquid, tradable asset.

### Value ③: Trust Search Engine (Lens Function)

RootLens search isn't just image search—it's a **trust verification tool**:

> "Is this image registered as a verified 'authentic' proof?"

- Supports both semantic (text) and image (camera) search
- Value increases as more users register more images
- "No hit ≠ fake" but "Hit = verified" is certain

---

## 🔑 Technical Differentiation

### "Accept if Root is Hardware Signed" Design

> Even if edited/processed, if the root is hardware-signed, we accept it as valuable content

Why?
- News photos require cropping and color adjustment
- Art requires editing as part of creation
- What matters is "the first frame was captured by camera"

### Robust Ownership via Mutual Linking

```
Arweave (Proof Data) ←→ cNFT (Ownership)

• Arweave records target cNFT address
• cNFT records Arweave URI
• Valid proof requires both to match

→ Copying one side is invalid
→ After burn, re-minting doesn't match Arweave record
→ Hijacking is impossible
```

---

## 🚧 Hackathon Scope & Roadmap

We prioritized **Core Architecture Validation** and **UI/UX** for this hackathon. Some security features are planned for Phase 2 to fit within the submission timeline.

| Feature | Status | Note |
|---|---|---|
| **C2PA Validation (Client)** | ✅ Done | WASM-based verification in browser |
| **Asset ID Prediction** | ✅ Done | Deterministic PDA calculation |
| **Solana Pay Verification** | ✅ Done | On-chain balance change verification |
| **Mutual Linking Logic** | ✅ Done | Full cross-referencing check |
| **Server-Side C2PA + TEE** | ⏳ Phase 2 | Complete trustless execution: Server-side C2PA re-verification using `c2pa-node` + TEE-based worker execution (AWS Nitro Enclaves/Intel SGX) with cryptographic attestation. |
| **Multi-Tree Scaling** | ⏳ Phase 2 | Currently single-threaded (`concurrency: 1`) to ensure sequential minting. Phase 2 will introduce random tree selection for parallel processing. |

**Why this trade-off?**
We focused on demonstrating the **novelty of the Asset ID prediction mechanism** and the **C2PA x Solana user experience** first. The server-side validation is a standard engineering task (implementing existing libraries), whereas our architectural approach to C2PA/Solana integration is a new research area.

### 🔮 Phase 2 Vision: Complete Trustless Execution

RootLens's goal is **complete trustless operation** from capture to verification.

**Current Architecture Challenge:**
- ✅ **Camera hardware** cryptographically proves image authenticity (C2PA)
- ✅ **Post-mint verification** is fully trustless (anyone can verify on-chain)
- ⚠️ **Upload process** requires trusting the server operator

**Why Server-Side Minting is Architecturally Required:**

RootLens's mutual linking design depends on **Asset ID prediction**, which requires:
1. **Serial processing**: One mint at a time to read `numMinted` accurately
2. **Deterministic ordering**: Predict → Upload to Arweave → Mint in sequence
3. **Gas-free UX**: Server pays minting costs, users don't need SOL

❌ **Client-side minting** would break this:
- Users could mint in any order → prediction accuracy drops
- Users would need SOL for gas fees → bad UX
- Users would need to sign mint transactions → added friction

✅ **Server-side minting is necessary**, but creates a trust assumption.

**Phase 2 Solution: Server-Side C2PA Re-Verification + TEE Execution**

Two-pronged approach to achieve trustless server operation:

**1. Server-Side C2PA Re-Verification**
- Worker downloads uploaded files from R2
- Re-verifies C2PA signatures using `c2pa-node` library
- Rejects uploads if server-side verification fails
- Eliminates trust assumption for C2PA validation

**2. Trusted Execution Environments (TEE)**

Execute the worker code inside a **cryptographically isolated hardware environment**:

```
┌─────────────────────────────────────────────────────────────┐
│  TEE (AWS Nitro Enclaves / Intel SGX / AMD SEV)             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  RootLens Worker (Public Code)                        │  │
│  │  ├─ Download file from R2                             │  │
│  │  ├─ C2PA verification (c2pa-node) ← Server-side       │  │
│  │  ├─ Asset ID prediction                               │  │
│  │  ├─ Arweave upload                                    │  │
│  │  └─ cNFT mint                                         │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  🔒 Code is cryptographically locked                        │
│     Even the operator cannot modify it                      │
│                                                             │
│  📜 Attestation: "Running SHA256(code) = abc123..."         │
│     → Anyone can verify the exact code being executed       │
└─────────────────────────────────────────────────────────────┘
```

**Benefits:**
- **Trustless server operation**: Code integrity proven by hardware
- **Same UX**: Users still don't sign anything or pay gas
- **Same performance**: Serial processing maintained
- **Verifiable**: Anyone can check the attestation and code hash

**The Ultimate Vision:**

> **"Camera hardware proves the image is real. Server hardware proves the minting is honest. End-to-end hardware trust."**

This completes RootLens's "Hardware Trust" philosophy:
- **MVP (Current)**: C2PA hardware signatures + trustless post-mint verification (✅ Done)
- **Phase 2**: Server-side C2PA re-verification + TEE-based execution (⏳ ~2 months)

**Why This Matters:**

RootLens is built on the concept of **"Proof of Reality"** — trusting hardware over humans. Phase 2 extends this trust model to the server layer, creating a fully trustless system while maintaining the UX and architectural benefits of centralized processing.

**Implementation Approach:**
1. Add `c2pa-node` verification to worker (straightforward port of frontend logic)
2. Migrate infrastructure to AWS EC2 Nitro-enabled instances
3. Containerize worker for Enclave execution
4. Implement Attestation API for public verification
5. Integrate AWS KMS for secure key management

📅 **Implementation Timeline**: ~2 months post-hackathon for production-ready trustless execution.

---

## 📁 Project Structure

```
RootLens/
├── frontend/              # Next.js 15 app
│   ├── app/              # App Router pages
│   ├── components/       # React components
│   └── lib/              # Utilities, C2PA verification
├── worker/               # Background job processor (Railway)
│   ├── src/              # Worker logic
│   └── jobs/             # Job handlers
├── lens-worker/          # Cloudflare Workers (Lens search)
└── document/             # Documentation
    ├── mvp/              # MVP specs
    └── phase2/           # Future improvements
```

---

## 🚀 Vision: Towards an AI-Human Coexistence Future

AI-generated content and human-captured reality content.

Both are valuable. Both are necessary.

But **losing the ability to distinguish** them is dangerous for society.

RootLens:
- **Proves "authenticity" with C2PA**
- **Clarifies "ownership" with blockchain**

Building **infrastructure for trust and ownership** in the AI age.

> "In an age of AI-generated everything, proof of reality becomes valuable. RootLens gives it ownership."

---

## 📝 FAQ

### Q: Can I use RootLens without a C2PA-compatible camera?

A: Currently, Sony α7 series, Google Pixel (specific models), Nikon Z9, Leica, etc. are compatible. Compatible devices are rapidly increasing. Smartphone adoption is accelerating; expected to become mainstream within a few years.

For this demo, please use our provided sample images.

### Q: How is this different from a Web2 C2PA stock site?

A: Authenticity proof is the same (C2PA's power). The difference is in handling "ownership":

- **Web2**: Just records "who owns what" in DB. Difficult to claim rights after leaks, trade rights, prevent hijacking
- **RootLens**: Links to wallets, NFT-izes for rights liquidity, completely prevents hijacking with mutual linking

### Q: Is "tamper-proof" thanks to blockchain?

A: No. Content tamper-proof/detection is achieved by **C2PA alone**. Blockchain's role is recording "who owns it" and "rights liquidity."

### Q: Why Solana?

A: cNFT (compressed NFT) technology enables mass minting at low cost. For a model issuing one proof NFT per image, low gas fees are essential.

---

## 📞 Contact

For questions about this submission:
- GitHub: [github.com/yudai-mori-2004/RootLens](https://github.com/yudai-mori-2004/RootLens)
- Demo Site: [rootlens.io](https://www.rootlens.io/)

---

## 📜 License

MIT License - see [LICENSE](./LICENSE) file for details

---

**RootLens** - *Proof of Reality, Ownership on Chain.*

Built for Solana Student Hackathon 2025


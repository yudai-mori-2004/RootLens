# RootLens

> **Proof of Reality, Ownership on Chain**

**RootLens** is a P2P marketplace that combines C2PA hardware signatures with blockchain technology to enable direct licensing of verified authentic content—establishing clear ownership while eliminating intermediaries.

## 🎬 Demo Video

**Watch the 3-minute pitch:** [RootLens | Proof of Reality Marketplace on Solana](https://youtu.be/d0EfjTB6ceM)

## 🐦 Follow Us

**Stay updated:** [@RootLens_sol on X](https://x.com/RootLens_sol)

---

## 🎯 One-Liner

**"A P2P marketplace that establishes ownership and enables direct licensing of verified authentic content"**

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
- But there's no marketplace to **license** content with that proof directly from creators
- No clear way to establish who owns the rights to that content

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

- Links ownership of verified content to wallets as **NFTs (digital rights anchor)**
- Enables **direct P2P licensing** without intermediaries
- Prevents hijacking through **mutual linking design**

**Additional value blockchain provides:**
- Clear ownership attribution (on-chain rights registry)
- Direct creator monetization (99.9% revenue share)
- Hijacking prevention (mutual linking)

---

## 🔧 Technology Role Division (Important)

| What We Want to Achieve | Technology | Possible with Web2? |
|---|---|---|
| Content authenticity proof | **C2PA** | ✓ Yes |
| Tamper detection | **C2PA** | ✓ Yes |
| Provenance preservation | **C2PA** | ✓ Yes |
| Clear ownership attribution | **Blockchain** | △ DB records possible, but... |
| Direct P2P creator payments | **Blockchain** | ✗ Difficult |
| Hijacking prevention | **Blockchain** | ✗ Difficult |

> C2PA alone enables trustless authenticity verification. Blockchain handles "who owns it" and "direct monetization without intermediaries."

---

### 🔗 Bridging C2PA's Metadata Gap

**The Problem with C2PA Alone:**

C2PA signatures are often **lost when images are compressed or shared on social media**. When you download an image from Twitter/Instagram, the embedded C2PA metadata is typically stripped away—making verification impossible even if the image was originally authenticated.

**RootLens's Solution: Optimistic Proof via Asset Pages**

RootLens solves this by storing **permanent proof records on-chain** (Arweave + Solana) and displaying them via **Asset Pages**:

1. **Upload Phase**: C2PA-verified content → Proof data stored on Arweave (permanent) + cNFT minted on Solana
2. **Distribution Phase**: Image spreads on social media → C2PA metadata gets stripped
3. **Verification Phase**: Anyone can use **Lens (AI-powered visual search)** to find the original Asset Page

**Result:** Even without the original file's C2PA signature, the **"Proof of Reality" can be recovered** by searching visually similar content on RootLens.

> **This provides an "Optimistic Proof" of origin**—the on-chain proof records (Arweave + Solana) serve as trusted evidence, displayed via Asset Pages, even when you don't have access to the original file with embedded metadata.

**How It Works:**
- **Lens Search**: AI generates semantic descriptions of images and matches them via vector similarity
- **Not perceptual hashing**: Uses Cloudflare Workers AI (image captioning + text embeddings) for flexible, content-aware search
- **Asset Page**: Displays C2PA provenance data, ownership info, and licensing options—all verifiable on-chain

**Real-World Use Case:**
- A news photo spreads on Twitter (C2PA metadata stripped)
- Fact-checkers upload the image to **RootLens Search** (visual + semantic search)
- System finds the original Asset Page → shows it was captured by a verified photographer with hardware proof
- Trust restored, even without the original file's metadata

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
2. **Verify** - View Asset Pages with full provenance
3. **Search** - Use Lens feature (text or image search)
4. **Purchase** - License verified content directly from creators via SolanaPay

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

### 📱 Empirical Hardware Verification with Physical Devices

Unlike many projects that rely on simulated data, **RootLens was built and tested using physical Pixel 10 hardware.** We invested in the latest hardware to ensure our C2PA parsing and verification logic correctly handles **hardware-level signatures**. 

This hands-on validation allowed us to identify and resolve real-world edge cases—such as missing data hashes (relying on Instance ID as a fallback)—that simply cannot be observed in emulated environments. This ensures RootLens is production-ready for the next generation of C2PA-enabled devices.

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

#### What You Get When You Purchase

Unlike NFT speculation platforms, RootLens is a **professional content licensing marketplace**:

1. **Full-resolution original file** with embedded C2PA signature
2. **Permanent download access** - Re-download anytime (like traditional stock photo sites)

**That's it.** No complicated tokens, no speculation. Just high-quality verified content with cryptographic proof of authenticity.

Payment goes directly to the creator's wallet (99.9% via SolanaPay). No intermediaries.

### Value ②: Clear Rights Ownership & Direct Creator Payments

Previously, digital content "ownership" was ambiguous—creators had no way to prove they own their work.

With RootLens:
- Content rights are **linked to wallets as NFTs** (on-chain rights registry)
- **99.9% of licensing fees go directly to creators** via SolanaPay (no intermediaries)
- Even if original files leak, **legitimate rights holders can be identified on-chain**

This transforms content licensing into a **transparent, creator-first marketplace**—like Shutterstock, but P2P with cryptographic proof of ownership.

### Value ③: Trust Search Engine (Lens Function)

RootLens search isn't just image search—it's a **trust verification tool** that recovers proof even when metadata is stripped:

> "Is this image registered as a verified 'authentic' proof?"

**Key Use Cases:**

1. **Metadata Recovery**: Image shared on social media (C2PA stripped) → Lens search by visual similarity → Find original Asset Page with full provenance
2. **Fact-Checking**: Journalist sees viral photo → Upload to Lens → Verify if hardware-captured or AI-generated
3. **Content Sourcing**: AI company needs clean training data → Search by keyword → License only verified authentic images

**Network Effect:**
- Supports both semantic (text) and image (camera) search
- Value increases as more users register more images
- "No hit ≠ fake" but "Hit = verified" is certain

> **This turns Lens into a "reverse image search for reality"**—bridging the gap between stripped social media images and their original cryptographic proofs.

---

## 🔑 Technical Differentiation

### 1. The "Hardware-First" Protocol

**"Accept if Root is Hardware-Signed, Reject if Content is AI-Synthesized"**

We draw a clear line between **Post-Processing (Adjustment)** and **Generative Editing (Synthesis)**.

**Valid (Standard Post-Processing):**
Adjusting what was captured by the sensor. This includes cropping, color correction, and exposure adjustment—essential steps for professional journalism and art.

**Invalid (Generative AI Modification):**
Creating what was never there. Our protocol rejects any content modified by Generative Fill, In-painting, or Out-painting. Even if the original was a real photo, AI-injected pixels break the "Chain of Reality."

> **The "First Frame" Principle:**
>
> What matters is that the *Pixel Provenance* originates from a physical sensor. RootLens mandates that the C2PA manifest must prove the content is a descendant of a hardware-signed capture, without generative "creation" steps in its history.

---

### 2. Robust Ownership via Mutual Linking

**Bridging Reality and Scarcity**

We don't just store an image; we lock the **Audit Trail** of that reality.

**Arweave (Proof Data) ←→ cNFT (Ownership)**

- **Immutable Manifest:** Arweave stores the original hardware signature and the full edit history. If an AI tool modifies the image, the C2PA signature chain is flagged, rendering the proof invalid.
- **Mutual Verification:**
  1. **Arweave** records the target **cNFT address**.
  2. **cNFT** records the **Arweave URI**.

  *Validation requirement:* A proof is only "Authentic" if both records point to each other.

> **Why this matters:**
>
> - **No Hijacking:** You cannot attach a real proof to a fake NFT.
> - **No Spoofing:** You cannot re-mint a burned asset and claim its old history.
> - **No AI Injection:** Any generative modification breaks the mathematical link between the physical sensor and the digital asset.

---

## 🚧 Hackathon Scope & Roadmap

We prioritized **Core Architecture Validation** and **UI/UX** for this hackathon. Some security features are planned for Phase 2 to fit within the submission timeline.

| Feature | Status | Note |
|---|---|---|
| **C2PA Validation (Client)** | ✅ Done | WASM-based verification in browser |
| **Asset ID Prediction** | ✅ Done | Deterministic PDA calculation |
| **Solana Pay Verification** | ✅ Done | On-chain balance change verification |
| **Mutual Linking Logic** | ✅ Done | Full cross-referencing check |
| **Server-Side C2PA Verification** | ⏳ Phase 2 | Add server-side C2PA re-verification using `c2pa-node` to prevent fraudulent uploads at the source. |
| **Multi-Tree Scaling** | ⏳ Phase 2 | Currently single-threaded (`concurrency: 1`) to ensure sequential minting. Phase 2 will introduce random tree selection for parallel processing. |
| **DoS Protection** | ⏳ Phase 2 | Subscription plans with Privy KYC-based rate limiting for free tier. |

**Why this trade-off? (Strategic Focus)**

For this hackathon submission, we made a strategic decision to defer **Server-side C2PA Re-verification**.

- **Why?**: Implementing server-side verification is a standard engineering task using existing libraries (e.g., `c2pa-node`). We prioritized proving the feasibility of our **unique protocol** over implementing established security patterns.
- **Our Focus**: We allocated our limited timeline to prove the feasibility of **novel architectural components**:
  1. **Deterministic Asset ID Prediction**: Solving the circular dependency between Arweave and Solana.
  2. **Lens Search**: Demonstrating how AI can recover "trust" from visual data alone.

*Note: The architecture for server-side verification is fully designed and documented in `document/phase2/`.*

### 🔮 Phase 2 Vision: Trustless Infrastructure via TEE

**The "Trust Gap" in Current Web3-Bridge Architecture:**

RootLens's mutual linking design depends on **Asset ID prediction**, which currently requires a server-side worker to:
1. Fetch the latest Merkle Tree state.
2. Predict the next leaf index.
3. Perform the minting transaction.

While the *result* is verifiable on-chain, the *process* of minting (specifically the C2PA re-verification and the integrity of the upload) currently relies on a centralized server.

**Phase 2 Solution: Trusted Execution Environment (TEE)**

To eliminate the need to trust the server operator, we are moving the core processing logic into a **TEE (e.g., AWS Nitro Enclaves, Azure Confidential Computing, or Phala Network)**.

1.  **Verifiable C2PA Parsing**: The Node.js worker running inside the TEE will perform the hardware signature verification. Because it's in a TEE, the server owner cannot modify the verification code to accept fake signatures.
2.  **Attestation-based Minting**: The TEE generates a **Remote Attestation**, a cryptographic proof that the exact, audited code is running on genuine hardware.
3.  **Trustless Bridge**: The TEE itself will hold the Solana private key (or sign via a proxy) and execute the minting only after successful C2PA validation.

> **The Result: Total Verification Sovereignty**
>
> - **Trustless Content**: Guaranteed by C2PA Hardware Signatures.
> - **Trustless Ownership**: Guaranteed by Solana/Arweave Mutual Linking.
> - **Trustless Processing**: Guaranteed by TEE Execution Proofs.

By shifting to TEE, RootLens transforms from a "Verifiable Marketplace" to a **"Trustless Provenance Protocol"**, where the server operator has zero power to forge or manipulate content records.

📅 **Implementation Timeline**: Phase 2 implementation focusing on TEE integration is scheduled for Q1 2026.

---

## 📁 Project Structure

```
RootLens/
├── frontend/              # Next.js 15 app
│   ├── app/
│   │   ├── [locale]/      # i18n Routing pages
│   │   ├── components/    # Domain components
│   │   └── lib/           # C2PA verification & Helpers
│   └── components/ui/     # shadcn/ui components
├── worker/                # Background job processor (Railway)
│   └── src/               # Worker logic (Minting, Arweave)
├── lens-worker/           # Cloudflare Workers (Lens search)
└── document/              # Documentation
    ├── mvp/               # MVP specs
    └── phase2/            # Future improvements
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

A: Authenticity proof is the same (C2PA's power). The difference is in handling "ownership" and "revenue flow":

- **Web2**: Records in DB. High fees (30-70%), difficult to prove ownership after leaks, platform-dependent
- **RootLens**: Links to wallets as NFTs, 99.9% goes directly to creators via P2P transactions, completely prevents hijacking with mutual linking

### Q: Is "tamper-proof" thanks to blockchain?

A: No. Content tamper-proof/detection is achieved by **C2PA alone**. Blockchain's role is recording "who owns it" and enabling "P2P direct transactions."

### Q: Why Solana?

A: cNFT (compressed NFT) technology enables mass minting at low cost. For a model issuing one proof NFT per image, low gas fees are essential.

### Q: Can NFTs be transferred?

A: Technically, yes. cNFTs are transferable on Solana. If the cNFT holder changes, all subsequent licensing revenue will be paid to the new holder's wallet. This allows creators to sell future revenue rights to third parties if desired. However, RootLens primarily focuses on direct creator-to-buyer licensing and maximizing revenue for creators—not speculative NFT trading.

---

## 📞 Contact

For questions about this submission:
- GitHub: [github.com/yudai-mori-2004/RootLens](https://github.com/yudai-mori-2004/RootLens)
- Demo Site: [rootlens.io](https://www.rootlens.io/)

---

## 👨‍💻 Team

**Yudai Mori** (Solo Project)

> "Built entirely by one person in 2 weeks for the Solana Student Hackathon 2025."

---

## 📜 License

MIT License - see [LICENSE](./LICENSE) file for details

---

**RootLens** - *Proof of Reality, Ownership on Chain.*

Built for Solana Student Hackathon 2025


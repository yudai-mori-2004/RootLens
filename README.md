# RootLens

Robot training data, sourced from real homes.

A camera app where anyone can film household tasks and get paid when AI companies license the footage.

## Demo

[![RootLens 3-minute demo](https://cdn.loom.com/sessions/thumbnails/4cb5a0bf683f41c8ac4103775894613f-with-play.gif)](https://www.loom.com/share/4cb5a0bf683f41c8ac4103775894613f)

▶ **[Watch the 3-minute demo on Loom](https://www.loom.com/share/4cb5a0bf683f41c8ac4103775894613f)**

## Why

Robot intelligence is evolving fast, and a major reason is human action footage — robots learn how to move by watching people perform tasks. But high-quality footage of real household tasks is massively scarce.

Buyers face their own bottleneck. Starting August 2026, the EU AI Act tightens enforcement on training data. A single clip with unclear rights can trigger massive fines, so AI companies need data at scale with verifiable rights.

RootLens turns everyday filming into a marketplace for that data — with on-chain proof of every rights holder, from capture to license.

## How it works

**Film** — Pick a household task. Film first-person, two-handed. The app tracks 21 hand joints in real time and vibrates if your hand drifts off-frame, since you cannot touch the screen while filming. AI scores and classifies each clip before upload, and bad takes get rejected automatically.

**Prove** — Faces and text are auto-blurred. You confirm the blurred version before anything leaves the device. The clip is signed with C2PA (the content provenance standard backed by Adobe, Google, Microsoft, and others), with the signing key bound to the smartphone's secure enclave. Both the original and the redacted versions are signed.

**Mint** — A cloud TEE (Trusted Execution Environment, a sealed runtime that even our own team cannot inspect) verifies the C2PA chain and mints a Root NFT on Solana, anchored to your wallet. The Root NFT is your on-chain ownership token for this footage. The TEE code is open source and remote-attestable, so no one can forge a Root NFT.

**Earn** — Stake your Root NFT to put the footage on the market. When a buyer pays, a smart contract mints them a separate license NFT, which is their on-chain right to use the footage for AI training. Revenue flows back to the Root NFT holder automatically. No platform processing, no payout cycle.


## Stack

- **Mobile app** — React Native (Expo), iOS + Android
- **Hand pose** — iOS Vision / Android MediaPipe HandLandmarker
- **C2PA signing** — c2pa-rs via device secure enclave
- **Verification pipeline** — cloud TEE, end-to-end encrypted
- **On-chain** — Solana (Root NFT + License NFT, Anchor program)
- **Auth** — Privy

## Built on

- **[Title Protocol](https://github.com/yudai-mori-2004/title-protocol)** — the open-source verification layer that handles Root NFT issuance trustlessly. RootLens is the first application built on top of it.
- **[C2PA](https://c2pa.org/)** — content provenance standard co-developed by Adobe, Google, Microsoft, and others.
- **Solana** — Root NFT and License NFT are recorded on-chain.

## License

See [LICENSE](LICENSE).

# RootLens Trustless Verification Module

This module performs content verification entirely client-side.
It connects ONLY to:

- **Solana RPC** — for on-chain cNFT data (GlobalConfig, collection membership)
- **Off-chain storage** — for signed_json (TEE signatures, via storage URI)
- **WASM binary source** — for pHash computation (same binary as TEE, hash-verified)

It does **NOT** connect to any RootLens server endpoint.
All verification can be independently reproduced by anyone
with access to the `content_hash` and a Solana RPC endpoint.

## Architecture

```
Browser
  ├── verify-content.ts    Main verification orchestrator (§7.4)
  │     ├── Ed25519 TEE signature verification
  │     ├── Collection membership check (vs GlobalConfig)
  │     ├── C2PA provenance chain validation
  │     ├── content_hash match
  │     └── Originality check (duplicate resolution)
  ├── phash-wasm.ts        Perceptual hash via WASM (§6.3)
  │     ├── WASM binary fetched from GlobalConfig
  │     ├── SHA-256 hash verified against on-chain wasm_hash
  │     └── Hamming distance ≤ 5 threshold
  ├── content-resolver.ts  Interface for DAS providers
  │     └── resolvers/helius.ts  DAS API implementation
  └── config.ts            GlobalConfig fetched from Solana RPC
```

## Trust Model

- **General users**: Trust the RootLens brand (practical basis)
- **Skeptics**: Open DevTools → All Solana RPC and off-chain storage requests are visible in the Network tab. No RootLens server calls appear for verification data.

See SPECS_JA.md §7.4.4 for the DevTools verification traceability specification.

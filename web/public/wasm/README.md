# RootLens Browser WASM Modules

Browser-side WASM binaries used for client-side content verification.

## Modules

| File | Source | Purpose | Last Updated |
|------|--------|---------|-------------|
| `jarosz.wasm` | `native/jarosz-wasm/` (copied from TP `wasm-host/src/jarosz.rs`) | Jarosz filter downsampling for PDQ hash computation | 2026-03-30 |

## Dynamically Loaded (from GlobalConfig)

These are NOT stored in this directory. They are fetched at runtime from
Title Protocol's `trusted_wasm_modules` in GlobalConfig, with SHA-256 hash
verification before execution.

| Extension ID | Purpose | Loaded From |
|---|---|---|
| `image-pdq` | 256-bit PDQ perceptual hash (DCT + quantization) | GlobalConfig `wasm_source` URL |
| `video-vpdq` | Per-frame PDQ hash sequence | GlobalConfig `wasm_source` URL |

## Architecture

```
Browser
  1. Canvas → RGBA pixels
  2. jarosz.wasm (local) → 64x64 grayscale (Jarosz filter, identical to TEE)
  3. image-pdq.wasm (GlobalConfig) → 256-bit PDQ hash
  4. Compare with on-chain PDQ → Hamming distance
```

`jarosz.wasm` ensures the downsampling step produces bit-identical results
to the TEE host implementation. The PDQ WASM is the same binary the TEE
executes, fetched and hash-verified from on-chain GlobalConfig.

## Updating jarosz.wasm

When Title Protocol updates `wasm-host/src/jarosz.rs`:

```bash
cp ../title-protocol/crates/wasm-host/src/jarosz.rs native/jarosz-wasm/src/jarosz_impl.rs
cd native/jarosz-wasm && cargo build --target wasm32-unknown-unknown --release
cp target/wasm32-unknown-unknown/release/jarosz_wasm.wasm ../../web/public/wasm/jarosz.wasm
```

## Verified Against

- Title Protocol commit: latest (2026-03-30)
- `image-pdq` WASM: Meta ThreatExchange PDQ compatible, 256-bit
- Jarosz algorithm: matches `wasm-host/src/jarosz.rs` (BT.601 luminance, 2-pass box filter)
- Test: PDQ hash distance 0-2 against `pdqhash` Python package reference

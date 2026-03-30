/**
 * image-pdq.wasm をブラウザで実行するランナー。
 *
 * 2段階のWASM実行で、TEEと同一のPDQハッシュを再現する:
 *   1. jarosz.wasm (ローカル) — Canvas RGBA → 64x64 グレースケール (Jarosz filter)
 *   2. image-pdq.wasm (GlobalConfig) — 64x64 → 256bit PDQ hash (DCT + Torben median)
 *
 * jarosz.wasm はTP wasm-host/src/jarosz.rs と同一のRustソースからビルド。
 * image-pdq.wasm はGlobalConfigから動的取得しSHA-256照合後に実行。
 */

import { getGlobalConfigData, findWasmVersionByHash } from "./config";

// ---------------------------------------------------------------------------
// WASM キャッシュ
// ---------------------------------------------------------------------------

const wasmCache = new Map<string, ArrayBuffer>();
let jaroszWasmCache: ArrayBuffer | null = null;

async function loadWasmByHash(extensionId: string, wasmHash: string): Promise<ArrayBuffer> {
  const normalized = wasmHash.replace(/^0x/, "");
  const cached = wasmCache.get(normalized);
  if (cached) return cached;

  const globalConfig = await getGlobalConfigData();
  const version = findWasmVersionByHash(globalConfig.trustedWasmModules, extensionId, wasmHash);

  if (!version) {
    throw new Error(`${extensionId} WASM version with hash ${normalized.slice(0, 16)}... not found in GlobalConfig`);
  }

  const res = await fetch(version.wasm_source);
  if (!res.ok) {
    throw new Error(`Failed to fetch WASM from ${version.wasm_source}: ${res.status}`);
  }
  const buf = await res.arrayBuffer();

  const hashBuf = await crypto.subtle.digest("SHA-256", buf);
  const hashHex = Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (hashHex !== normalized) {
    throw new Error(`WASM hash mismatch: expected ${normalized}, got ${hashHex}. Binary may be tampered.`);
  }

  console.log(`%cWASM binary loaded & SHA-256 verified: %c${extensionId} ${hashHex.slice(0, 16)}...`, "color:#6b7280;font-style:italic;", "color:inherit;");
  wasmCache.set(normalized, buf);
  return buf;
}

async function loadJaroszWasm(): Promise<ArrayBuffer> {
  if (jaroszWasmCache) return jaroszWasmCache;
  const res = await fetch("/wasm/jarosz.wasm");
  if (!res.ok) throw new Error(`Failed to load jarosz.wasm: ${res.status}`);
  jaroszWasmCache = await res.arrayBuffer();
  return jaroszWasmCache;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * 画像URLから256bit PDQハッシュを計算する。
 *
 * @param imageUrl - 表示画像のURL（PerceptualInputs.imageUrl）
 * @param onchainWasmHash - image-pdq Extension cNFT の wasm_hash（省略時は最新active版）
 * @returns 64文字のhex文字列（256bit PDQ hash）
 */
export async function computePdqWasm(imageUrl: string, onchainWasmHash?: string): Promise<string> {
  let wasmHashToUse = onchainWasmHash;

  if (!wasmHashToUse) {
    const globalConfig = await getGlobalConfigData();
    const mod = globalConfig.trustedWasmModules.find(m => m.extension_id === "image-pdq");
    const active = mod?.versions.find(v => v.status === 0);
    if (!active) throw new Error("No active image-pdq WASM version in GlobalConfig");
    wasmHashToUse = active.wasm_hash;
  }

  const [pdqWasmBuf, jaroszWasmBuf, rgba] = await Promise.all([
    loadWasmByHash("image-pdq", wasmHashToUse),
    loadJaroszWasm(),
    loadImageRgba(imageUrl),
  ]);

  // Step 1: Jarosz downsample (RGBA → 64x64 grayscale)
  const gray64 = await runJarosz(jaroszWasmBuf, rgba.data, rgba.width, rgba.height);

  // Step 2: PDQ hash (64x64 grayscale → 256bit hash)
  return runPdq(pdqWasmBuf, gray64);
}

// ---------------------------------------------------------------------------
// Step 1: Jarosz downsampling (local WASM)
// ---------------------------------------------------------------------------

async function runJarosz(
  wasmBuf: ArrayBuffer,
  rgba: Uint8Array,
  width: number,
  height: number,
): Promise<Uint8Array> {
  const { instance } = await WebAssembly.instantiate(wasmBuf, {});
  const memory = instance.exports.memory as WebAssembly.Memory;
  const allocMem = instance.exports.alloc_mem as (size: number) => number;
  const downsample = instance.exports.downsample_rgba_64x64 as (
    rgbaPtr: number, width: number, height: number, outPtr: number,
  ) => number;

  // Allocate and copy RGBA data into WASM memory
  const rgbaSize = width * height * 4;
  const rgbaPtr = allocMem(rgbaSize);
  const outputPtr = allocMem(64 * 64);
  new Uint8Array(memory.buffer, rgbaPtr, rgbaSize).set(rgba);

  const resultLen = downsample(rgbaPtr, width, height, outputPtr);
  if (resultLen === 0) throw new Error("Jarosz downsample failed");

  return new Uint8Array(memory.buffer, outputPtr, 64 * 64).slice();
}

// ---------------------------------------------------------------------------
// Step 2: PDQ hash (GlobalConfig WASM)
// ---------------------------------------------------------------------------

async function runPdq(wasmBuf: ArrayBuffer, gray64: Uint8Array): Promise<string> {
  let memory: WebAssembly.Memory;
  const decodedGray = gray64;

  const importObject = {
    env: {
      // PDQ WASM calls decode_content first (we return success immediately)
      decode_content: (_paramsPtr: number, _paramsLen: number, metadataPtr: number): number => {
        const view = new DataView(memory.buffer);
        // metadata: width=64, height=64, channels=1
        view.setUint32(metadataPtr, 64, true);
        view.setUint32(metadataPtr + 4, 64, true);
        view.setUint32(metadataPtr + 8, 1, true);
        return 0;
      },
      // PDQ WASM calls get_decoded_feature({"op":"grayscale_resize","width":64,"height":64})
      // We return the pre-computed Jarosz output
      get_decoded_feature: (_specPtr: number, _specLen: number, outputPtr: number): number => {
        const dst = new Uint8Array(memory.buffer, outputPtr, 64 * 64);
        dst.set(decodedGray);
        return 64 * 64;
      },
      read_content_chunk: (_offset: number, _length: number, _bufPtr: number): number => 0,
      get_content_length: (): number => 0,
      get_extension_input: (_bufPtr: number, _bufLen: number): number => 0,
    },
  };

  const { instance } = await WebAssembly.instantiate(wasmBuf, importObject);
  memory = instance.exports.memory as WebAssembly.Memory;

  const process = instance.exports.process as () => number;
  const resultPtr = process();
  if (resultPtr === 0) throw new Error("PDQ WASM returned null");

  const view = new DataView(memory.buffer);
  const jsonLen = view.getUint32(resultPtr, true);
  const jsonBytes = new Uint8Array(memory.buffer, resultPtr + 4, jsonLen);
  const result = JSON.parse(new TextDecoder().decode(jsonBytes));

  if (result.error) throw new Error(`PDQ WASM error: ${result.error}`);
  return result.pdqhash;
}

// ---------------------------------------------------------------------------
// Image loading (Canvas → RGBA)
// ---------------------------------------------------------------------------

interface ImageRgba {
  data: Uint8Array;
  width: number;
  height: number;
}

async function loadImageRgba(url: string): Promise<ImageRgba> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.crossOrigin = "anonymous";
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    el.src = url;
  });

  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d", { colorSpace: "srgb" })!;
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  return {
    data: new Uint8Array(imageData.data.buffer),
    width: canvas.width,
    height: canvas.height,
  };
}

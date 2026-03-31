/**
 * 仕様書 §7.4 クライアントサイド検証 — PDQ / vPDQ (純粋 TypeScript)
 *
 * Meta ThreatExchange 互換 256bit PDQ ハッシュをブラウザ内で計算する。
 * WASM 依存なし。Title Protocol の WASM と同一アルゴリズム:
 *
 *   1. Canvas → RGBA → BT.601 grayscale
 *   2. Jarosz filter (box×2 = tent) で平滑化
 *   3. Center-pixel decimation → 64×64
 *   4. 2D DCT → 16×16 低周波係数 (DC skip)
 *   5. Torben median → 256bit 量子化
 *
 * 画像: computePdq(imageUrl) → 1つのhash
 * 動画: computeVpdq(videoUrl) → フレーム別hash配列
 *
 * 参照実装:
 *   - title-protocol/wasm/image-pdq/src/lib.rs (DCT + hash)
 *   - title-protocol/wasm/video-vpdq/src/lib.rs (frame sampling)
 *   - title-protocol/crates/wasm-host/src/jarosz.rs (downsampling)
 */

const SIZE = 64;
const LOW_FREQ = 16;
const HASH_BITS = 256;
const HASH_BYTES = 32;
const VPDQ_QUALITY_THRESHOLD = 50;

// ---------------------------------------------------------------------------
// Public API — Image
// ---------------------------------------------------------------------------

/**
 * 画像URLから256bit PDQハッシュを計算する。
 * @returns 64文字のhex文字列 (256bit, MSB-first)
 */
export async function computePdq(imageUrl: string): Promise<string> {
  const { data, width, height } = await loadImageRgba(imageUrl);
  const gray = rgbaToGray(data, width, height);
  const gray64 = jaroszDownsample(gray, width, height, SIZE, SIZE);
  return pdqHash256(gray64);
}

// ---------------------------------------------------------------------------
// Public API — Video
// ---------------------------------------------------------------------------

export interface VpdqFrame {
  pdqhash: string;
  quality: number;
  timestamp: number;
}

/** 指定タイムスタンプ配列の各時刻でシーク＆PDQ計算する */
export async function computeVpdq(
  videoUrl: string,
  timestamps: number[],
): Promise<VpdqFrame[]> {
  const video = await loadVideo(videoUrl);
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d", { colorSpace: "srgb" })!;

  const frames: VpdqFrame[] = [];
  for (const t of timestamps) {
    const frame = await computeFrameAt(video, canvas, ctx, t);
    if (frame) frames.push(frame);
  }

  video.remove();
  return frames;
}

/** 指定タイムスタンプのフレームをPDQ計算。quality < 50 は null */
async function computeFrameAt(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  t: number,
): Promise<VpdqFrame | null> {
  const rgba = await seekAndCapture(video, canvas, ctx, t);
  const gray = rgbaToGray(rgba, canvas.width, canvas.height);
  const gray64 = jaroszDownsample(gray, canvas.width, canvas.height, SIZE, SIZE);
  const quality = computeQuality(gray64);

  if (quality < VPDQ_QUALITY_THRESHOLD) return null;

  const hash = pdqHash256(gray64);
  return { pdqhash: hash, quality, timestamp: Math.round(t * 1000) / 1000 };
}

// ---------------------------------------------------------------------------
// Video loading
// ---------------------------------------------------------------------------

async function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise<HTMLVideoElement>((resolve, reject) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = () => resolve(video);
    video.onerror = () => reject(new Error(`Failed to load video: ${url}`));
    video.src = url;
  });
}

async function seekAndCapture(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  time: number,
): Promise<Uint8Array> {
  await new Promise<void>((resolve) => {
    video.onseeked = () => resolve();
    video.currentTime = time;
  });
  ctx.drawImage(video, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return new Uint8Array(imageData.data.buffer);
}

// ---------------------------------------------------------------------------
// Image loading (Canvas → RGBA)
// ---------------------------------------------------------------------------

async function loadImageRgba(url: string): Promise<{ data: Uint8Array; width: number; height: number }> {
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

// ---------------------------------------------------------------------------
// RGBA → Grayscale (BT.601)
// ---------------------------------------------------------------------------

function rgbaToGray(rgba: Uint8Array, w: number, h: number): Float32Array {
  const n = w * h;
  const gray = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const off = i * 4;
    gray[i] = 0.299 * rgba[off] + 0.587 * rgba[off + 1] + 0.114 * rgba[off + 2];
  }
  return gray;
}

// ---------------------------------------------------------------------------
// Jarosz downsampling
// ---------------------------------------------------------------------------

function computeWindowSize(oldDim: number, newDim: number): number {
  return Math.floor((oldDim + 2 * newDim - 1) / (2 * newDim));
}

function box1d(
  input: Float32Array,
  output: Float32Array,
  numLines: number,
  lineLen: number,
  stride: number,
  lineStride: number,
  windowSize: number,
): void {
  const halfWindow = Math.floor(windowSize / 2);

  for (let line = 0; line < numLines; line++) {
    const base = line * lineStride;
    let sum = 0;
    let outIdx = 0;

    // Phase 1: growing accumulation, no output
    for (let j = 0; j < halfWindow && j < lineLen; j++) {
      sum += input[base + j * stride];
    }

    // Phase 2: growing window with output
    let windowLen = halfWindow;
    for (let j = 0; j < halfWindow + 1 && j < lineLen; j++) {
      if (j + halfWindow < lineLen) {
        sum += input[base + (j + halfWindow) * stride];
      }
      windowLen++;
      output[base + outIdx * stride] = sum / windowLen;
      outIdx++;
    }

    // Phase 3: sliding full window
    const fullLen = windowLen;
    for (let j = halfWindow + 1; j + halfWindow < lineLen; j++) {
      sum += input[base + (j + halfWindow) * stride];
      sum -= input[base + (j - halfWindow - 1) * stride];
      output[base + outIdx * stride] = sum / fullLen;
      outIdx++;
    }

    // Phase 4: shrinking window
    for (let j = Math.max(0, lineLen - halfWindow); j < lineLen; j++) {
      if (j > halfWindow + 1) {
        sum -= input[base + (j - halfWindow - 1) * stride];
        windowLen--;
      }
      output[base + outIdx * stride] = sum / windowLen;
      outIdx++;
    }
  }
}

function boxAlongRows(input: Float32Array, output: Float32Array, rows: number, cols: number, w: number): void {
  box1d(input, output, rows, cols, 1, cols, w);
}

function boxAlongCols(input: Float32Array, output: Float32Array, rows: number, cols: number, w: number): void {
  box1d(input, output, cols, rows, cols, 1, w);
}

function jaroszDownsample(
  gray: Float32Array,
  inW: number,
  inH: number,
  outW: number,
  outH: number,
): Float32Array {
  const windowR = computeWindowSize(inW, outW);
  const windowC = computeWindowSize(inH, outH);

  const buf1 = new Float32Array(gray);
  const buf2 = new Float32Array(inW * inH);

  // 2 reps of (horizontal box + vertical box) = tent filter
  for (let i = 0; i < 2; i++) {
    boxAlongRows(buf1, buf2, inH, inW, windowR);
    boxAlongCols(buf2, buf1, inH, inW, windowC);
  }

  // Center-pixel decimation
  const output = new Float32Array(outW * outH);
  for (let oi = 0; oi < outH; oi++) {
    const ini = Math.floor((oi + 0.5) * inH / outH);
    for (let oj = 0; oj < outW; oj++) {
      const inj = Math.floor((oj + 0.5) * inW / outW);
      output[oi * outW + oj] = Math.max(0, Math.min(255, Math.round(buf1[ini * inW + inj])));
    }
  }

  return output;
}

// ---------------------------------------------------------------------------
// 2D DCT → 16×16 low-frequency coefficients (DC skip)
// ---------------------------------------------------------------------------

function buildDctMatrix(): Float64Array {
  const D = new Float64Array(LOW_FREQ * SIZE);
  const scale = Math.sqrt(2.0 / SIZE);
  for (let i = 0; i < LOW_FREQ; i++) {
    for (let j = 0; j < SIZE; j++) {
      D[i * SIZE + j] = scale * Math.cos((Math.PI / (2 * SIZE)) * (i + 1) * (2 * j + 1));
    }
  }
  return D;
}

let _dctMatrix: Float64Array | null = null;
function getDctMatrix(): Float64Array {
  if (!_dctMatrix) _dctMatrix = buildDctMatrix();
  return _dctMatrix;
}

function dct16x16(gray64: Float32Array): Float64Array {
  const D = getDctMatrix();
  const dct = new Float64Array(LOW_FREQ * LOW_FREQ);

  const T = new Float64Array(LOW_FREQ * SIZE);
  for (let i = 0; i < LOW_FREQ; i++) {
    for (let j = 0; j < SIZE; j++) {
      let sum = 0;
      for (let k = 0; k < SIZE; k++) {
        sum += D[i * SIZE + k] * gray64[k * SIZE + j];
      }
      T[i * SIZE + j] = sum;
    }
  }

  for (let i = 0; i < LOW_FREQ; i++) {
    for (let j = 0; j < LOW_FREQ; j++) {
      let sum = 0;
      for (let k = 0; k < SIZE; k++) {
        sum += T[i * SIZE + k] * D[j * SIZE + k];
      }
      dct[i * LOW_FREQ + j] = sum;
    }
  }

  return dct;
}

// ---------------------------------------------------------------------------
// Torben median
// ---------------------------------------------------------------------------

function torbenMedian(values: Float64Array): number {
  const n = values.length;
  let min = values[0];
  let max = values[0];
  for (let i = 1; i < n; i++) {
    if (values[i] < min) min = values[i];
    if (values[i] > max) max = values[i];
  }

  const half = (n + 1) >>> 1;

  while (true) {
    const guess = (min + max) / 2;
    let less = 0;
    let greater = 0;
    let equal = 0;
    let maxLt = min;
    let minGt = max;

    for (let i = 0; i < n; i++) {
      const v = values[i];
      if (v < guess) {
        less++;
        if (v > maxLt) maxLt = v;
      } else if (v > guess) {
        greater++;
        if (v < minGt) minGt = v;
      } else {
        equal++;
      }
    }

    if (less <= half && greater <= half) {
      if (less >= half) return maxLt;
      if (less + equal >= half) return guess;
      return minGt;
    }

    if (less > greater) {
      max = maxLt;
    } else {
      min = minGt;
    }
  }
}

// ---------------------------------------------------------------------------
// Quality metric (gradient energy)
// ---------------------------------------------------------------------------

function computeQuality(gray64: Float32Array): number {
  let gradientSum = 0;

  // Vertical gradients
  for (let i = 0; i < SIZE - 1; i++) {
    for (let j = 0; j < SIZE; j++) {
      const d = Math.abs((gray64[i * SIZE + j] - gray64[(i + 1) * SIZE + j]) * 100 / 255);
      gradientSum += d;
    }
  }

  // Horizontal gradients
  for (let i = 0; i < SIZE; i++) {
    for (let j = 0; j < SIZE - 1; j++) {
      const d = Math.abs((gray64[i * SIZE + j] - gray64[i * SIZE + j + 1]) * 100 / 255);
      gradientSum += d;
    }
  }

  const quality = Math.floor(gradientSum / 90);
  return quality > 100 ? 100 : quality;
}

// ---------------------------------------------------------------------------
// Quantize → 256-bit hash (MSB-first hex)
// ---------------------------------------------------------------------------

function pdqHash256(gray64: Float32Array): string {
  const dct = dct16x16(gray64);
  const median = torbenMedian(dct);

  const hash = new Uint8Array(HASH_BYTES);
  for (let i = 0; i < HASH_BITS; i++) {
    if (dct[i] > median) {
      hash[i >>> 3] |= 1 << (i & 7);
    }
  }

  // MSB-first (Meta convention)
  let hex = "";
  for (let i = HASH_BYTES - 1; i >= 0; i--) {
    hex += hash[i].toString(16).padStart(2, "0");
  }
  return hex;
}

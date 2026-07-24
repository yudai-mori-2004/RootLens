"use client";

// ぼかしシールの効きを現場でその場確認するテストページ。
// スマホでカメラ撮影 → ブラウザ内で ArUco 検出 → 実寸換算ゾーンをブラー → 即プレビュー。
// 画像は端末の外に出ない (全処理ローカル)。 換算規則は納品パイプライン (fpvlabs.py) と同じ:
// 黒枠実寸 70mm、 ゾーン倍率 1.15、 矩形は ±20° 以内を水平スナップ。
// 検出辞書は 4X4_1000 (= OpenCV の 4X4_50 と同一系列) なので、 カタログ外 id は無視する。

import { useRef, useState } from "react";

// js-aruco2 (MIT) は古い CommonJS/グローバル型でバンドラが食えないため、 public/aruco/ に
// ベンダリングして実行時に <script> で読む。 読み込み後は window.AR が使える。
interface ArucoMarker {
  id: number;
  corners: { x: number; y: number }[];
}
interface ArGlobal {
  Detector: new (opts: { dictionaryName: string }) => {
    detect(image: { width: number; height: number; data: Uint8ClampedArray }): ArucoMarker[];
  };
}

let arucoLoading: Promise<ArGlobal> | null = null;
function ensureAruco(): Promise<ArGlobal> {
  if (!arucoLoading) {
    arucoLoading = (async () => {
      for (const src of ["/aruco/cv.js", "/aruco/aruco.js", "/aruco/aruco_4x4_1000.js"]) {
        await new Promise<void>((resolve, reject) => {
          const s = document.createElement("script");
          s.src = src;
          s.onload = () => resolve();
          s.onerror = () => reject(new Error(`読み込み失敗: ${src}`));
          document.head.appendChild(s);
        });
      }
      return (window as unknown as { AR: ArGlobal }).AR;
    })();
  }
  return arucoLoading;
}

const MARKER_CM = 7.0;
const ZONE_SCALE = 1.15;
const MAX_DIM = 2000;

type ZoneDef =
  | { shape: "circle"; rCm: number; label: string }
  | { shape: "rect"; wCm: number; hCm: number; label: string };

const ZONES: Record<number, ZoneDef> = {
  0: { shape: "circle", rCm: 25, label: "半径25cm" },
  1: { shape: "circle", rCm: 50, label: "半径50cm" },
  2: { shape: "circle", rCm: 100, label: "半径1m" },
  10: { shape: "rect", wCm: 40, hCm: 30, label: "縦30cm×横40cm" },
  11: { shape: "rect", wCm: 90, hCm: 60, label: "縦60cm×横90cm" },
  12: { shape: "rect", wCm: 180, hCm: 90, label: "縦90cm×横180cm" },
};

type Zone =
  | { kind: "circle"; cx: number; cy: number; r: number }
  | { kind: "poly"; pts: { x: number; y: number }[] };

function zoneFromMarker(corners: { x: number; y: number }[], def: ZoneDef): Zone {
  const side =
    corners.reduce((acc, p, i) => {
      const q = corners[(i + 1) % 4];
      return acc + Math.hypot(q.x - p.x, q.y - p.y);
    }, 0) / 4;
  const pxPerCm = (side / MARKER_CM) * ZONE_SCALE;
  const cx = corners.reduce((a, p) => a + p.x, 0) / 4;
  const cy = corners.reduce((a, p) => a + p.y, 0) / 4;
  if (def.shape === "circle") {
    return { kind: "circle", cx, cy, r: def.rCm * pxPerCm };
  }
  let ux = corners[1].x - corners[0].x;
  let uy = corners[1].y - corners[0].y;
  const un = Math.hypot(ux, uy) || 1;
  ux /= un; uy /= un;
  // 紙の微妙な傾きでゾーンが斜めになると不自然なので ±20° は画像軸にスナップ (fpvlabs.py と同じ)。
  const ang = (Math.atan2(uy, ux) * 180) / Math.PI;
  const snapped = Math.round(ang / 90) * 90;
  if (Math.abs(ang - snapped) <= 20) {
    const rad = (snapped * Math.PI) / 180;
    ux = Math.cos(rad); uy = Math.sin(rad);
  }
  const vx = -uy;
  const vy = ux;
  const hw = (def.wCm * pxPerCm) / 2;
  const hh = (def.hCm * pxPerCm) / 2;
  return {
    kind: "poly",
    pts: [
      { x: cx - ux * hw - vx * hh, y: cy - uy * hw - vy * hh },
      { x: cx + ux * hw - vx * hh, y: cy + uy * hw - vy * hh },
      { x: cx + ux * hw + vx * hh, y: cy + uy * hw + vy * hh },
      { x: cx - ux * hw + vx * hh, y: cy - uy * hw + vy * hh },
    ],
  };
}

function tracePath(ctx: CanvasRenderingContext2D, zone: Zone) {
  ctx.beginPath();
  if (zone.kind === "circle") {
    ctx.arc(zone.cx, zone.cy, zone.r, 0, Math.PI * 2);
  } else {
    ctx.moveTo(zone.pts[0].x, zone.pts[0].y);
    for (const p of zone.pts.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.closePath();
  }
}

/** src をぼかした全面画像を作る。 ctx.filter が無い環境では縮小 → 拡大の簡易ブラー。 */
function blurredCopy(src: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = src.width;
  out.height = src.height;
  const ctx = out.getContext("2d")!;
  if (typeof ctx.filter === "string") {
    ctx.filter = `blur(${Math.max(24, Math.round(src.width / 25))}px)`;
    ctx.drawImage(src, 0, 0);
  } else {
    const tiny = document.createElement("canvas");
    tiny.width = Math.max(1, Math.round(src.width / 16));
    tiny.height = Math.max(1, Math.round(src.height / 16));
    tiny.getContext("2d")!.drawImage(src, 0, 0, tiny.width, tiny.height);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(tiny, 0, 0, out.width, out.height);
  }
  return out;
}

export default function Page() {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<string>("シールが映るように撮影してください");
  const [busy, setBusy] = useState(false);
  const [hasResult, setHasResult] = useState(false);

  const process = async (file: File) => {
    setBusy(true);
    setStatus("処理中…");
    try {
      const url = URL.createObjectURL(file);
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("画像を読み込めませんでした"));
        img.src = url;
      });
      URL.revokeObjectURL(url);

      const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);

      const src = document.createElement("canvas");
      src.width = w;
      src.height = h;
      const srcCtx = src.getContext("2d")!;
      srcCtx.drawImage(img, 0, 0, w, h);

      const AR = await ensureAruco();
      const detector = new AR.Detector({ dictionaryName: "ARUCO_4X4_1000" });
      const markers = detector
        .detect(srcCtx.getImageData(0, 0, w, h))
        .filter((m) => ZONES[m.id] !== undefined);

      const canvas = canvasRef.current!;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(src, 0, 0);

      if (markers.length > 0) {
        const blurred = blurredCopy(src);
        for (const m of markers) {
          const zone = zoneFromMarker(m.corners, ZONES[m.id]);
          ctx.save();
          tracePath(ctx, zone);
          ctx.clip();
          ctx.drawImage(blurred, 0, 0);
          ctx.restore();
        }
      }

      setHasResult(true);
      setStatus(
        markers.length > 0
          ? `シール ${markers.length} 枚: ` + markers.map((m) => ZONES[m.id].label).join(" / ")
          : "シールが見つかりませんでした。近づいて撮り直してください",
      );
    } catch (e) {
      setStatus(`エラー: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{
      minHeight: "100dvh", background: "#131519", color: "#f4f1fa",
      display: "flex", flexDirection: "column", alignItems: "center",
      padding: "20px 16px 40px", gap: 14,
    }}>
      <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>ぼかしシール テスト</h1>
      <p style={{ margin: 0, fontSize: 13, color: "#a8afbe", textAlign: "center" }}>{status}</p>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void process(f);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => fileRef.current?.click()}
        style={{
          padding: "14px 28px", borderRadius: 999, border: "none",
          background: "#ffe600", color: "#131519", fontSize: 16, fontWeight: 800,
          opacity: busy ? 0.5 : 1,
        }}
      >
        {hasResult ? "もう一度撮影する" : "撮影する"}
      </button>

      <canvas
        ref={canvasRef}
        style={{
          display: hasResult ? "block" : "none",
          width: "100%", maxWidth: 720, borderRadius: 8,
          border: "1px solid #2c3140",
        }}
      />
      <p style={{ margin: 0, fontSize: 11, color: "#7a8090", textAlign: "center" }}>
        画像は端末内で処理され、送信されません。実際の納品ぼかしと同じ換算(シール原寸印刷が前提)です。
      </p>
    </div>
  );
}

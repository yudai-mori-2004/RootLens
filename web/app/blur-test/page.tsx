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
  Detector: new (opts: { dictionaryName: string; maxHammingDistance?: number }) => {
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
// 検出は原寸 (上限 4200px) で行い、 表示だけ縮小する。 遠く・小さく写ったマーカーは
// 縮小画像だと消えるため、 検出解像度がそのまま検出距離になる。
const DETECT_MAX = 4200;
const DISPLAY_MAX = 2000;

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

type Zone = { pts: { x: number; y: number }[] };

// 遠近採用の条件とガード (fpvlabs.py の NG_PERSP_* と同値)。
const PERSP_MIN_RATIO = 1.15;
const PERSP_MAX_RATIO = 4.0;

// 本番 (fpvlabs.py の _ng_zone_from_corners) と同一の式。 遠近が効いている場合は
// 4 隅のホモグラフィでゾーンを面に貼り付け (= 奥ほど縮む)、 それ以外・ガード落ちは
// 上辺・左辺ベクトルのアフィン (rect = 平行四辺形、 circle = 楕円)。
function zoneFromMarker(corners: { x: number; y: number }[], def: ZoneDef): Zone {
  const cx = corners.reduce((a, p) => a + p.x, 0) / 4;
  const cy = corners.reduce((a, p) => a + p.y, 0) / 4;

  // ── ゾーンの面上オフセット (cm、 マーカー中心原点、 余裕率込み) ──
  const offs: { x: number; y: number }[] = [];
  if (def.shape === "circle") {
    for (let i = 0; i < 32; i++) {
      const t = (i / 32) * Math.PI * 2;
      offs.push({ x: Math.cos(t) * def.rCm * ZONE_SCALE, y: Math.sin(t) * def.rCm * ZONE_SCALE });
    }
  } else {
    const hw = (def.wCm / 2) * ZONE_SCALE;
    const hh = (def.hCm / 2) * ZONE_SCALE;
    offs.push({ x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh });
  }

  // ── ホモグラフィ (単位正方形 → マーカー 4 隅、 Heckbert の閉形式) ──
  const [p0, p1, p2, p3] = corners;
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;
  const den = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(den) > 1e-9) {
    const g = (dx3 * dy2 - dx2 * dy3) / den;
    const h2 = (dx1 * dy3 - dx3 * dy1) / den;
    const a = p1.x - p0.x + g * p1.x;
    const b = p3.x - p0.x + h2 * p3.x;
    const d = p1.y - p0.y + g * p1.y;
    const e = p3.y - p0.y + h2 * p3.y;
    const uv = offs.map((o) => ({ u: o.x / MARKER_CM + 0.5, v: o.y / MARKER_CM + 0.5 }));
    const Ws = uv.map((q) => g * q.u + h2 * q.v + 1);
    if (Ws.every((W) => W > 1e-6)) {
      const ratio = Math.max(...Ws) / Math.min(...Ws);
      if (ratio > PERSP_MIN_RATIO && ratio <= PERSP_MAX_RATIO) {
        const pts = uv.map((q, i) => ({
          x: (a * q.u + b * q.v + p0.x) / Ws[i],
          y: (d * q.u + e * q.v + p0.y) / Ws[i],
        }));
        if (pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) {
          return { pts };
        }
      }
    }
  }

  // ── アフィン経路 (正面寄り、 またはホモグラフィのガード落ち) ──
  let Ux = (p1.x - p0.x) / MARKER_CM;
  let Uy = (p1.y - p0.y) / MARKER_CM;
  let Vx = (p3.x - p0.x) / MARKER_CM;
  let Vy = (p3.y - p0.y) / MARKER_CM;
  if (def.shape !== "circle") {
    // 紙の微妙な傾きでゾーンが斜めになると不自然なので ±20° は画像軸にスナップ。
    // 円は面内回転に不変なのでスナップ不要。
    const ang = (Math.atan2(Uy, Ux) * 180) / Math.PI;
    const snapped = Math.round(ang / 90) * 90;
    if (Math.abs(ang - snapped) <= 20) {
      const rad = (snapped * Math.PI) / 180;
      const lu = Math.hypot(Ux, Uy);
      const lv = Math.hypot(Vx, Vy);
      Ux = Math.cos(rad) * lu; Uy = Math.sin(rad) * lu;
      Vx = -Math.sin(rad) * lv; Vy = Math.cos(rad) * lv;
    }
  }
  return {
    pts: offs.map((o) => ({ x: cx + o.x * Ux + o.y * Vx, y: cy + o.x * Uy + o.y * Vy })),
  };
}

function tracePath(ctx: CanvasRenderingContext2D, zone: Zone) {
  ctx.beginPath();
  ctx.moveTo(zone.pts[0].x, zone.pts[0].y);
  for (const p of zone.pts.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.closePath();
}

/** src をぼかした全面画像を作る。 ctx.filter が無い環境では縮小 → 拡大の簡易ブラー。 */
function blurredCopy(src: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = src.width;
  out.height = src.height;
  const ctx = out.getContext("2d")!;
  if (typeof ctx.filter === "string") {
    // 本番はフレーム半分の箱ぼかし (= ほぼ平坦) なので、 強度もそれに寄せる。
    ctx.filter = `blur(${Math.max(48, Math.round(Math.max(src.width, src.height) / 10))}px)`;
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

      const AR = await ensureAruco();
      // ハミング距離 2 まで許容 (辞書既定は厳格一致で、 小さく写ったマーカーを落とす)。
      // カタログ外 id は下で捨てるので誤検出の実害はない。
      const detector = new AR.Detector({ dictionaryName: "ARUCO_4X4_1000", maxHammingDistance: 2 });

      const detectAt = (dim: number) => {
        const s = Math.min(1, dim / Math.max(img.naturalWidth, img.naturalHeight));
        const dw = Math.round(img.naturalWidth * s);
        const dh = Math.round(img.naturalHeight * s);
        const c = document.createElement("canvas");
        c.width = dw;
        c.height = dh;
        const cctx = c.getContext("2d")!;
        cctx.drawImage(img, 0, 0, dw, dh);
        const found = detector
          .detect(cctx.getImageData(0, 0, dw, dh))
          .filter((m) => ZONES[m.id] !== undefined);
        return { found, dw };
      };

      // 原寸で検出 → 見つからなければ半分の解像度でリトライ (ブレ・ノイズには縮小が効くことがある)。
      let pass = detectAt(DETECT_MAX);
      if (pass.found.length === 0) pass = detectAt(DETECT_MAX / 2);
      const detectW = pass.dw;

      const dispScale = Math.min(1, DISPLAY_MAX / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * dispScale);
      const h = Math.round(img.naturalHeight * dispScale);
      const src = document.createElement("canvas");
      src.width = w;
      src.height = h;
      src.getContext("2d")!.drawImage(img, 0, 0, w, h);

      // 検出座標系 → 表示座標系 (ゾーン計算は相似なので座標を先に縮めれば足りる)
      const k = w / detectW;
      const markers = pass.found.map((m) => ({
        id: m.id,
        corners: m.corners.map((p) => ({ x: p.x * k, y: p.y * k })),
      }));

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

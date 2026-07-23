"use client";

// センサーの値パネル。 現時刻の左右の手の映り (アイコン) + 動きの強さと回転の速さの
// 時系列グラフ 2 枚。 高さは固定 (px)、 Y スケールはウィンドウ内の実データに追従する。

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { usePlayhead } from "./TimeContext";
import type { TimeSeriesData } from "./types";

const WINDOW_S = 10;              // 折れ線に描く過去秒数
const GRAPH_HEIGHT_PX = 96;       // グラフ 1 枚の高さ (パネル全体が広がらないよう固定)
const CHANNEL_COLORS = ["#ff3d80", "#7be89c", "#5aa8ff"];  // x / y / z

interface Props {
  data: TimeSeriesData;
}

export default function NumericPanel({ data }: Props) {
  const t = useTranslations("pages.sample.numeric");
  const state = usePlayhead();
  const idx = Math.min(data.hands.length - 1, Math.max(0, Math.floor(state.t * data.hz)));
  const handOn = !!data.hands[idx];

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      width: "100%",
      background: "#0b0d11", color: "#e8ebf2",
      padding: 12, gap: 10,
      fontFamily: "'JetBrains Mono', 'SF Mono', ui-monospace, monospace", fontSize: 11,
      minWidth: 0,
    }}>
      <HandRow
        leftOn={handOn}
        rightOn={handOn}
        title={t("hands")}
        leftLabel={t("leftHand")}
        rightLabel={t("rightHand")}
      />
      <SeriesCanvas label={t("accel")} data={data} idxNow={idx} field="accel" />
      <SeriesCanvas label={t("gyro")} data={data} idxNow={idx} field="gyro" />
    </div>
  );
}

function HandRow({ leftOn, rightOn, title, leftLabel, rightLabel }: {
  leftOn: boolean;
  rightOn: boolean;
  title: string;
  leftLabel: string;
  rightLabel: string;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      borderBottom: "1px solid rgba(255,255,255,0.06)",
      paddingBottom: 8,
    }}>
      <div style={{
        fontSize: 9, color: "#7a8090",
        textTransform: "uppercase", letterSpacing: 1,
      }}>{title}</div>
      <div style={{ display: "flex", gap: 10, marginLeft: "auto" }}>
        <HandIcon on={leftOn} side="left" label={leftLabel} />
        <HandIcon on={rightOn} side="right" label={rightLabel} />
      </div>
    </div>
  );
}

// シンプルな塗り手のシルエット (親指付きの片面ミトン風)。 5 本指の細部は 22px では
// 潰れて読みにくいので、 「手が映っているか」 だけを一目で伝えるシルエット 1 枚にする。
// 右手は左右反転。
function HandIcon({ on, side, label }: { on: boolean; side: "left" | "right"; label: string }) {
  const color = on ? "#ffffff" : "#3a3f4a";
  return (
    <svg
      width={22} height={22} viewBox="0 0 24 24"
      style={{ transform: side === "right" ? "scaleX(-1)" : undefined, display: "block" }}
      aria-label={label}
    >
      <path
        d="M8 22a4 4 0 0 1-4-4v-6l1.5-1.5v6l1-.5v-9a1.5 1.5 0 0 1 3 0v6l1-.5v-9a1.5 1.5 0 0 1 3 0v9l1 .5v-7a1.5 1.5 0 0 1 3 0v7l1 .5v-5a1.5 1.5 0 0 1 3 0v9a4 4 0 0 1-4 4z"
        fill={color}
      />
    </svg>
  );
}

function SeriesCanvas({ data, idxNow, field, label }: {
  data: TimeSeriesData;
  idxNow: number;
  field: "accel" | "gyro";
  label: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // 親のリサイズを ResizeObserver で拾う。 これが無いと、 パネルの初期レンダー時の
  // 幅で canvas.width が固定され、 後で親が広がっても描画バッファは古い幅のまま = 右側が
  // 引き伸ばされた黒 (というより「描画が右まで届かない黒」) として見える。 idxNow の変化
  // (30 Hz) だけを頼りに再描画するのでは、 幅変化のタイミングが取れない。
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const update = () => {
      const rect = c.getBoundingClientRect();
      setSize({ w: rect.width, h: rect.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || size.w === 0 || size.h === 0) return;
    const dpr = window.devicePixelRatio || 1;
    // 描画バッファは実寸 × dpr。 setState で幅が変わったときも含めて毎回更新する。
    c.width = Math.max(1, Math.floor(size.w * dpr));
    c.height = Math.max(1, Math.floor(size.h * dpr));
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);

    const samples = Math.floor(WINDOW_S * data.hz);
    const start = Math.max(0, idxNow - samples);
    const end = idxNow;
    const totalSpan = samples;  // 常に固定 (= 未来側にも余白を残さない: 現在時刻が右端)

    // Y スケール: このウィンドウ内の実データの絶対値ピーク基準。 静止時は最低値を敷く。
    const minRange = field === "accel" ? 3 : 2;
    let peak = 0;
    for (let i = start; i <= end; i++) {
      const v = data.imu[field][i];
      if (!v) continue;
      peak = Math.max(peak, Math.abs(v[0]), Math.abs(v[1]), Math.abs(v[2]));
    }
    const yMax = Math.max(minRange, peak * 1.15);

    // 0 ライン
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, size.h / 2);
    ctx.lineTo(size.w, size.h / 2);
    ctx.stroke();

    // 見出し (左上)
    ctx.fillStyle = "#7a8090";
    ctx.font = "9px ui-monospace";
    ctx.fillText(label, 4, 10);

    // 凡例 (右上): 色ドット + x / y / z のラベル。 チャンネルとグラフの色を対応付ける。
    const legendPad = 4;
    const swatch = 6;
    const gap = 3;
    const items = ["x", "y", "z"];
    // 右から詰めて描く。 各要素は [swatch][gap][文字幅+gap]。
    let cursorX = size.w - legendPad;
    for (let ch = 2; ch >= 0; ch--) {
      const label = items[ch];
      const textW = ctx.measureText(label).width;
      cursorX -= textW;
      ctx.fillStyle = "#7a8090";
      ctx.fillText(label, cursorX, 10);
      cursorX -= gap + swatch;
      ctx.fillStyle = CHANNEL_COLORS[ch];
      ctx.fillRect(cursorX, 10 - swatch, swatch, swatch);
      cursorX -= gap * 2;
    }

    if (end <= start) return;

    // 各チャンネル。 「現在」 が右端に来るように、 x はサンプル数 / totalSpan (= 固定) で
    // マップする。 これで再生初期 (端まで埋まっていない) のときも、 右側にちゃんと最新値が
    // 貼り付いて、 左側が未使用の状態になる (自然なオシロスコープの見え方)。
    for (let ch = 0; ch < 3; ch++) {
      ctx.strokeStyle = CHANNEL_COLORS[ch];
      ctx.lineWidth = 1;
      ctx.beginPath();
      let drew = false;
      for (let i = start; i <= end; i++) {
        const v = data.imu[field][i]?.[ch] ?? 0;
        // 現在時刻 (i=end) を右端 (x=w) に。 過去は左へ。
        const x = size.w - ((end - i) / totalSpan) * size.w;
        const y = size.h / 2 - (v / yMax) * (size.h / 2 - 8);
        if (!drew) { ctx.moveTo(x, y); drew = true; }
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }, [idxNow, data, field, label, size.w, size.h]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: "100%",
        height: GRAPH_HEIGHT_PX,
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 4,
        display: "block",
      }}
    />
  );
}

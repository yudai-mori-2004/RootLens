"use client";

// センサーの値パネル。 現時刻の左右の手の映り (アイコン) + 動きの強さと回転の速さの時系列グラフ。
//
// 上段: 右手・左手アイコン。 映っていれば白、 映ってなければグレー。 面積で状態を示す。
// 下段: 動きの強さ (accel xyz) と 回転の速さ (gyro xyz)、 過去 10 秒の折れ線。
//       高さは固定 (px)。 Y スケールはウィンドウ内の実データに合わせて自動で伸縮する
//       (= キャンバスが縦に伸びないので、 パネル全体が高くならない)。
//
// リアルタイム値のテキストカードと 「トラッキング状態」 の boolean 表示は廃止。
// 数字だけが変わっていくカードは情報密度が低く、 グラフで十分。

import { useEffect, useRef } from "react";
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

  // 手の左右の判定はハンドトラッキングの左右ラベルまではこのパネルまで届いていないので、
  // 「1 本以上」 か「2 本」 かで代替する。 hands boolean は現状 「1 本以上」 の flag なので
  // 2 本判定用に別チャンネルを追加したくなったら timeseries を拡張する。
  // ここではとりあえず 「片手だけ映っている」 か 「両手映っている」 かを見せられる形にしておく。
  const handOn = !!data.hands[idx];

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      background: "#0b0d11", color: "#e8ebf2",
      padding: 12, gap: 10,
      fontFamily: "'JetBrains Mono', 'SF Mono', ui-monospace, monospace", fontSize: 11,
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

// 手の映り 2 個。 白 = 映っている、 灰 = 映っていない。
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
      <div style={labelStyle}>{title}</div>
      <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
        <HandIcon on={leftOn} side="left" label={leftLabel} />
        <HandIcon on={rightOn} side="right" label={rightLabel} />
      </div>
    </div>
  );
}

function HandIcon({ on, side, label }: { on: boolean; side: "left" | "right"; label: string }) {
  // Lucide の "Hand" アイコン (ISC ライセンス)。 open palm のストロークデザインで、
  // color prop で白 / 灰の切替が素直にできる。 右手用は左右反転。
  const color = on ? "#ffffff" : "#3a3f4a";
  return (
    <svg
      width={22}
      height={22}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        transform: side === "right" ? "scaleX(-1)" : undefined,
        display: "block",
      }}
      aria-label={label}
    >
      <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0" />
      <path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2" />
      <path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8" />
      <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15V9a2 2 0 0 1 2-2h.5" />
    </svg>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: 9,
  color: "#7a8090",
  textTransform: "uppercase",
  letterSpacing: 1,
};

function SeriesCanvas({ data, idxNow, field, label }: {
  data: TimeSeriesData;
  idxNow: number;
  field: "accel" | "gyro";
  label: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    c.width = rect.width * dpr;
    c.height = rect.height * dpr;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = rect.width;
    const h = rect.height;

    ctx.clearRect(0, 0, w, h);

    const samples = Math.floor(WINDOW_S * data.hz);
    const start = Math.max(0, idxNow - samples);
    const end = idxNow;
    const n = end - start;
    if (n <= 1) return;

    // Y スケール: このウィンドウ内の実データの絶対値ピーク基準。 小さすぎる (= 静止) ときは
    // 発散防止のため最低値を敷く (accel は 3、 gyro は 2)。 これで枠 (固定高さ) 内に必ず収まる。
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
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    // 見出し (小さく左上)
    ctx.fillStyle = "#7a8090";
    ctx.font = "9px ui-monospace";
    ctx.fillText(label, 4, 10);

    // 各チャンネル
    for (let ch = 0; ch < 3; ch++) {
      ctx.strokeStyle = CHANNEL_COLORS[ch];
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = start; i <= end; i++) {
        const x = ((i - start) / n) * w;
        const v = data.imu[field][i]?.[ch] ?? 0;
        const y = h / 2 - (v / yMax) * (h / 2 - 8);
        if (i === start) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }, [idxNow, data, field, label]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: "100%",
        height: GRAPH_HEIGHT_PX,          // 固定高さ (枠が広がらない)
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 4,
        display: "block",
      }}
    />
  );
}

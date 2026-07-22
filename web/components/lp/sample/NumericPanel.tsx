"use client";

// センサ数値パネル。 現時刻の IMU 6 軸 + 手検出 boolean + トラッキング状態を
// リアルタイム更新 + ミニ時系列で表示する。
//
// レイアウトは 2 段:
//   上段: 現在値カード (accel xyz / gyro xyz / hand / tracking)
//   下段: 過去 10 秒の accel と gyro の折れ線 (Canvas 直描き。 recharts への依存を避ける)
//
// タイムスタンプは Store 由来。 状態が動くたび再描画。

import React, { useEffect, useRef } from "react";
import { usePlayhead } from "./TimeContext";
import type { TimeSeriesData } from "./types";

const WINDOW_S = 10;  // 折れ線に描く過去秒数

interface Props {
  data: TimeSeriesData;
}

const TRACKING_LABEL: Record<number, string> = {
  0: "not available",
  1: "limited",
  2: "normal",
};

const TRACKING_COLOR: Record<number, string> = {
  0: "#ff3d80",
  1: "#ffd400",
  2: "#7be89c",
};

export default function NumericPanel({ data }: Props) {
  const state = usePlayhead();
  const idx = Math.min(data.hands.length - 1, Math.max(0, Math.floor(state.t * data.hz)));

  const accel = data.imu.accel[idx] ?? [0, 0, 0];
  const gyro = data.imu.gyro[idx] ?? [0, 0, 0];
  const handOn = !!data.hands[idx];
  const tracking = data.tracking[idx] ?? 0;

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100%",
      background: "#0b0d11", color: "#e8ebf2", padding: 12, gap: 10,
      fontFamily: "'JetBrains Mono', 'SF Mono', ui-monospace, monospace", fontSize: 11,
    }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <Card label="加速度 (m/s²)" values={[
          ["x", accel[0]],
          ["y", accel[1]],
          ["z", accel[2]],
        ]} />
        <Card label="角速度 (rad/s)" values={[
          ["x", gyro[0]],
          ["y", gyro[1]],
          ["z", gyro[2]],
        ]} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div style={cardBoxStyle}>
          <div style={cardLabelStyle}>手の検出</div>
          <div style={{
            fontSize: 18, fontWeight: 600,
            color: handOn ? "#7be89c" : "#666",
          }}>
            {handOn ? "detected" : "—"}
          </div>
        </div>
        <div style={cardBoxStyle}>
          <div style={cardLabelStyle}>トラッキング</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: TRACKING_COLOR[tracking] ?? "#e8ebf2" }}>
            {TRACKING_LABEL[tracking] ?? String(tracking)}
          </div>
        </div>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
        <SeriesCanvas
          label="accel xyz"
          data={data}
          idxNow={idx}
          field="accel"
        />
        <SeriesCanvas
          label="gyro xyz"
          data={data}
          idxNow={idx}
          field="gyro"
        />
      </div>
    </div>
  );
}

const cardBoxStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.08)",
  padding: 8,
  borderRadius: 4,
};

const cardLabelStyle: React.CSSProperties = {
  fontSize: 9,
  color: "#7a8090",
  textTransform: "uppercase",
  letterSpacing: 1,
  marginBottom: 4,
};

function Card({ label, values }: { label: string; values: [string, number][] }) {
  return (
    <div style={cardBoxStyle}>
      <div style={cardLabelStyle}>{label}</div>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0 12px", fontSize: 12 }}>
        {values.map(([k, v]) => (
          // Fragment に key を付けるためこの形。 <>...</> だと key が乗せられない。
          <React.Fragment key={k}>
            <div style={{ color: "#7a8090" }}>{k}</div>
            <div style={{ fontVariantNumeric: "tabular-nums", textAlign: "right" }}>
              {v.toFixed(2)}
            </div>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

const CHANNEL_COLORS = ["#ff3d80", "#7be89c", "#5aa8ff"];

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

    // Y レンジ: 全 3 チャンネルの max |v| を左右対称で。 発散を防ぐため min 3 (accel) / 2 (gyro)。
    const minRange = field === "accel" ? 3 : 2;
    let peak = 0;
    for (let i = start; i <= end; i++) {
      const v = data.imu[field][i];
      if (!v) continue;
      peak = Math.max(peak, Math.abs(v[0]), Math.abs(v[1]), Math.abs(v[2]));
    }
    const yMax = Math.max(minRange, peak * 1.15);

    // 目盛り (0 line)
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    // ラベル
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
        flex: 1,
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 4,
        display: "block",
      }}
    />
  );
}

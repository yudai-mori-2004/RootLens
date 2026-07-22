"use client";

// クリップ全体の統計表示。 4 パネルの下に置く、 静的な事実のブロック。
// 5 セクションに分ける: 撮影 / 空間 / 手・トラッキング / センサ構成 / 出力サイズ。

import type { SummaryData } from "./types";

interface Props {
  summary: SummaryData;
}

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}分${s.toString().padStart(2, "0")}秒`;
}

function fmtBytes(b: number): string {
  if (b >= 1e9) return `${(b / 1e9).toFixed(2)} GB`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`;
  if (b >= 1e3) return `${(b / 1e3).toFixed(1)} KB`;
  return `${b} B`;
}

export default function SummaryBlock({ summary }: Props) {
  const cam = summary.camera;
  return (
    <div style={{
      display: "grid", gap: 24, padding: "24px 0",
      gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
      color: "#e8ebf2", fontSize: 13,
    }}>
      <Section title="このクリップ">
        <Row k="収録時間" v={fmtDuration(summary.durationSec)} />
        <Row k="フレーム数" v={summary.frames.toLocaleString()} />
        <Row k="実効 FPS" v={summary.fps.toFixed(1)} />
        <Row k="収録スタック" v={summary.recordingConfig} />
        <Row k="端末" v={summary.device ?? "—"} />
        <Row k="OS" v={summary.osVersion ?? "—"} />
      </Section>

      <Section title="空間">
        <Row k="歩行距離" v={`${summary.pathLengthM.toFixed(1)} m`} />
        <Row k="床面カバー" v={`${summary.areaM2.toFixed(1)} m²`} />
        <Row k="移動範囲 (x, y, z)" v={
          summary.trajectoryBBoxMax.map((mx, i) => `${(mx - summary.trajectoryBBoxMin[i]).toFixed(1)}`).join(" / ") + " m"
        } />
      </Section>

      <Section title="手・トラッキング">
        <Row k="手が映っていた割合" v={`${(summary.handDetectionRate * 100).toFixed(1)}%`} />
        <Row k="トラッキング正常率" v={`${(summary.trackingNormalRate * 100).toFixed(1)}%`} />
      </Section>

      {cam && (
        <Section title="カメラ">
          <Row k="解像度" v={`${cam.width ?? "?"} × ${cam.height ?? "?"}`} />
          <Row k="視野角" v={cam.field_of_view_deg ? `${cam.field_of_view_deg.toFixed(1)}°` : "—"} />
          <Row k="レンズ" v={cam.lens ?? "—"} />
          {cam.depth && (
            <Row k="LiDAR 深度" v={`${cam.depth.width} × ${cam.depth.height}`} />
          )}
        </Section>
      )}

      <Section title="出力サイズ">
        {Object.entries(summary.assets).map(([name, stats]) => (
          <Row key={name} k={name} v={fmtBytes(stats.bytes)} />
        ))}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{
        fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: "#7a8090",
        marginBottom: 8,
      }}>
        {title}
      </div>
      <div style={{ display: "grid", gap: 4 }}>{children}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <span style={{ color: "#7a8090" }}>{k}</span>
      <span style={{ fontVariantNumeric: "tabular-nums", textAlign: "right" }}>{v}</span>
    </div>
  );
}

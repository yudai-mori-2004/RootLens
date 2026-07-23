"use client";

// コンテンツセクション: session.mcap に含まれる各時系列トピックのスペックシート。
// 上のサマリー 4 本 (この 1 本 / 歩いた場所 / 認識のよさ / カメラ) が「わかりやすさ寄り」
// なのに対し、 こちらは研究用途の厳密な仕様を提示するタブ。 タブごとに 1 トピック。
//
// タブ構成は fpvlabs.py が MCAP に書き出す構成 (映像 / 深度 / 6DoF / IMU / トラッキング) に
// 一致させる。 手のランドマークとメッシュは現行の MCAP パイプラインには入っていないので、
// ここに載せると納品スペックと乖離するため出さない。

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { SummaryData } from "./types";

interface Props {
  summary: SummaryData;
}

type TabId = "video" | "depth" | "pose" | "imu";

export default function ContentsSection({ summary }: Props) {
  const t = useTranslations("pages.sample.contents");
  const L = (k: string) => t(`labels.${k}`);
  const V = (k: string) => t(`values.${k}`);

  const hasDepth = !!summary.camera?.depth;
  const cam = summary.camera;
  const cs: Record<string, unknown> = (summary.captureSettings as Record<string, unknown>) || {};

  // per-clip の実測値。 metadata.json から拾える範囲で埋め、 取れないものは — を出す。
  const videoRes = cam ? `${cam.width ?? "?"} × ${cam.height ?? "?"}` : "—";
  const videoFps = cam?.recording_fps ? `${cam.recording_fps.toFixed(0)} fps` : `${summary.fps.toFixed(0)} fps`;
  const depthRes = cam?.depth ? `${cam.depth.width} × ${cam.depth.height}` : "—";
  const depthFps = (cs.depth_rate_hz != null) ? `${cs.depth_rate_hz} fps` : videoFps;
  const imuRate = (cs.imu_rate_hz != null) ? `${cs.imu_rate_hz} Hz` : "—";

  const tabs: { id: TabId; rows: [string, string][] }[] = [
    {
      id: "video",
      rows: [
        [L("topic"), "/camera/rgb/compressed"],
        [L("messageType"), "sensor_msgs/CompressedImage"],
        [L("encoding"), V("videoEncoding")],
        [L("resolution"), videoRes],
        [L("rate"), videoFps],
        [L("processing"), V("videoProcessing")],
      ],
    },
    {
      id: "depth",
      rows: hasDepth ? [
        [L("topic"), "/camera/depth · /camera/depth/confidence"],
        [L("messageType"), "sensor_msgs/Image (16UC1 · mono8)"],
        [L("resolution"), depthRes],
        [L("rate"), depthFps],
        [L("unit"), V("depthUnit")],
        [L("confidence"), V("depthConfidence")],
      ] : [],
    },
    {
      id: "pose",
      rows: [
        [L("topic"), "/camera/pose"],
        [L("messageType"), "geometry_msgs/PoseStamped"],
        [L("rate"), videoFps],
        [L("coordinateSystem"), V("poseCoord")],
        [L("contents"), V("poseContents")],
      ],
    },
    {
      id: "imu",
      rows: [
        [L("topic"), "/device/imu"],
        [L("messageType"), "sensor_msgs/Imu"],
        [L("rate"), imuRate],
        [L("orientation"), V("imuOrientation")],
        [L("linearAcceleration"), V("imuAccel")],
        [L("angularVelocity"), V("imuGyro")],
        [L("coordinateSystem"), V("imuCoord")],
      ],
    },
  ];

  const initialActive: TabId = hasDepth ? "video" : "video";
  const [activeId, setActiveId] = useState<TabId>(initialActive);
  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0];

  return (
    <div style={{
      marginTop: 8,
      background: "#0b0d11",
      border: "1px solid #1a1d24",
      borderRadius: 8,
      color: "#e8ebf2",
    }}>
      <div style={{
        display: "flex", alignItems: "baseline", gap: 12,
        padding: "12px 16px 0", flexWrap: "wrap",
      }}>
        <div style={{
          fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: "#7a8090",
        }}>
          {t("section")}
        </div>
        <div style={{ fontSize: 12, color: "#7a8090" }}>{t("intro")}</div>
      </div>

      <div style={{
        display: "flex", flexWrap: "wrap", gap: 2,
        padding: "12px 12px 0",
        borderBottom: "1px solid #1a1d24",
      }}>
        {tabs.map((tab) => {
          const disabled = tab.id === "depth" && !hasDepth;
          const isActive = tab.id === activeId;
          return (
            <button
              key={tab.id}
              type="button"
              disabled={disabled}
              onClick={() => setActiveId(tab.id)}
              style={{
                padding: "8px 14px",
                border: "none",
                background: isActive ? "#151820" : "transparent",
                color: disabled ? "#4a4f5a" : isActive ? "#f4f1fa" : "#a8afbe",
                fontSize: 12,
                fontWeight: isActive ? 600 : 500,
                cursor: disabled ? "not-allowed" : "pointer",
                borderRadius: "4px 4px 0 0",
              }}
            >
              {t(`tabs.${tab.id}`)}
            </button>
          );
        })}
      </div>

      <div style={{ padding: "16px 20px", fontSize: 13 }}>
        {active.id === "depth" && !hasDepth ? (
          <div style={{ color: "#7a8090", fontSize: 12 }}>{t("depthUnavailable")}</div>
        ) : (
          <div style={{
            display: "grid",
            gridTemplateColumns: "minmax(140px, max-content) 1fr",
            columnGap: 24, rowGap: 6,
            fontFamily: "ui-monospace, 'SF Mono', 'JetBrains Mono', monospace",
          }}>
            {active.rows.map(([k, v]) => (
              <RowFrag key={k} k={k} v={v} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RowFrag({ k, v }: { k: string; v: string }) {
  return (
    <>
      <div style={{ color: "#7a8090" }}>{k}</div>
      <div style={{ color: "#e8ebf2", wordBreak: "break-word" }}>{v}</div>
    </>
  );
}

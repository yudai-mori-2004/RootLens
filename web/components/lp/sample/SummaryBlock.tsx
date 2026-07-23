"use client";

// クリップ全体の統計表示。 4 パネルの下に置く、 静的な事実のブロック。
// セクション: この 1 本 / 歩いた場所 / 認識のよさ / カメラ / 納品するもの (session.mcap)。
//
// 「納品するもの」 は取引先に渡す最終形式 (fpvlabs パイプラインの session.mcap = 顔ぼかし +
// Stera 互換 MCAP) を明示する。 LP に置いてある rgb.mp4 / depth.mp4 / mesh.glb 等は
// あくまでビジュアライザ配信用のビューアセットで、 商品ではない。 混同を避けるため出さない。

import { useLocale, useTranslations } from "next-intl";
import type { SummaryData } from "./types";

interface Props {
  summary: SummaryData;
}

function fmtDuration(sec: number, locale: string): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  if (locale === "en") {
    if (m === 0) return `${s}s`;
    return `${m}m ${s.toString().padStart(2, "0")}s`;
  }
  if (m === 0) return `${s}秒`;
  return `${m}分${s.toString().padStart(2, "0")}秒`;
}

function fmtBytes(b: number): string {
  if (b >= 1e9) return `${(b / 1e9).toFixed(2)} GB`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`;
  if (b >= 1e3) return `${(b / 1e3).toFixed(1)} KB`;
  return `${b} B`;
}

export default function SummaryBlock({ summary }: Props) {
  const t = useTranslations("pages.sample.summary");
  const locale = useLocale();
  const cam = summary.camera;
  const delivery = summary.delivery;

  return (
    <div style={{
      display: "grid", gap: 24, padding: "24px 0",
      gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
      color: "#e8ebf2", fontSize: 13,
    }}>
      <Section title={t("clipSection")}>
        <Row k={t("durationLabel")} v={fmtDuration(summary.durationSec, locale)} />
        <Row k={t("framesLabel")} v={summary.frames.toLocaleString()} />
        <Row k={t("fpsLabel")} v={summary.fps.toFixed(1)} />
        <Row k={t("deviceLabel")} v={summary.device ?? "—"} />
        <Row k={t("osLabel")} v={summary.osVersion ?? "—"} />
      </Section>

      <Section title={t("spaceSection")}>
        <Row k={t("pathLengthLabel")} v={`${summary.pathLengthM.toFixed(1)} m`} />
        <Row k={t("areaLabel")} v={`${summary.areaM2.toFixed(1)} m²`} />
        <Row k={t("bboxLabel")} v={
          (["x", "z", "y"] as const)
            .map((axis) => {
              const i = { x: 0, y: 1, z: 2 }[axis];
              return (summary.trajectoryBBoxMax[i] - summary.trajectoryBBoxMin[i]).toFixed(1);
            })
            .join(" × ") + " m"
        } />
      </Section>

      <Section title={t("qualitySection")}>
        <Row k={t("handRateLabel")} v={`${(summary.handDetectionRate * 100).toFixed(1)}%`} />
        <Row k={t("trackingRateLabel")} v={`${(summary.trackingNormalRate * 100).toFixed(1)}%`} />
      </Section>

      {cam && (
        // lens は Apple 内部呼称 (現状全クリップ "wide" 固定) で、 FOV と情報が重複するため
        // 表示しない。 一般スペックとして意味があるのは 解像度 / FOV / 深度解像度。
        <Section title={t("cameraSection")}>
          <Row k={t("resolutionLabel")} v={`${cam.width ?? "?"} × ${cam.height ?? "?"}`} />
          <Row k={t("fovLabel")} v={cam.field_of_view_deg ? `${cam.field_of_view_deg.toFixed(1)}°` : "—"} />
          {cam.depth && (
            <Row k={t("depthResolutionLabel")} v={`${cam.depth.width} × ${cam.depth.height}`} />
          )}
        </Section>
      )}

      <Section title={t("deliverySection")}>
        {delivery ? (
          <>
            <Row k={t("deliveryFormatLabel")} v={t("deliveryFormatValue")} />
            <Row k={t("deliveryBytesLabel")} v={fmtBytes(delivery.bytes)} />
            <Row k={t("deliveryContentsLabel")} v={t("deliveryContentsValue")} />
          </>
        ) : (
          <div style={{ color: "#7a8090", fontSize: 12 }}>{t("deliveryPending")}</div>
        )}
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
    <div style={{
      display: "grid",
      gridTemplateColumns: "auto 1fr",
      gap: 12,
      alignItems: "start",
    }}>
      <span style={{ color: "#7a8090" }}>{k}</span>
      <span style={{ fontVariantNumeric: "tabular-nums", textAlign: "right" }}>{v}</span>
    </div>
  );
}

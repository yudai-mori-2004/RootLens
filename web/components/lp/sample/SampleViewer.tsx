"use client";

// /sample の 4 パネル + タイムライン + サマリー全部乗せ。
// - パイプライン切替 (arkit / mentra) はここで state 管理。 available=false のオプションは
//   選択できるが、 選ぶとプレースホルダー表示 (assets が無い)。
// - trajectory / timeseries / summary を fetch でロードして子に流す。
// - RGB が master、 他は slave (詳細は TimeContext / RgbPanel 参照)。

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { TimeProvider } from "./TimeContext";
import RgbPanel from "./RgbPanel";
import DepthPanel from "./DepthPanel";
import ScenePanel from "./ScenePanel";
import NumericPanel from "./NumericPanel";
import TimelineBar from "./TimelineBar";
import SummaryBlock from "./SummaryBlock";
import type { PipelineOption, SummaryData, TimeSeriesData, TrajectoryData } from "./types";

interface Props {
  pipelines: PipelineOption[];
  /** 初期表示するパイプライン ID (無指定なら available=true の最初のもの)。 */
  initialPipelineId?: string;
}

export default function SampleViewer({ pipelines, initialPipelineId }: Props) {
  const t = useTranslations("pages.sample");
  const firstAvail = useMemo(() => pipelines.find((p) => p.available), [pipelines]);
  const [pipelineId, setPipelineId] = useState<string>(
    initialPipelineId ?? firstAvail?.id ?? pipelines[0].id,
  );
  const pipeline = useMemo(
    () => pipelines.find((p) => p.id === pipelineId) ?? pipelines[0],
    [pipelines, pipelineId],
  );

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "24px 20px 48px" }}>
      <Header
        pipelines={pipelines}
        active={pipeline.id}
        onChange={setPipelineId}
        description={pipeline.description}
        pageTitle={t("pageTitle")}
        preparingBadge={t("preparingBadge")}
      />
      {pipeline.available && pipeline.assets ? (
        <LoadedViewer assets={pipeline.assets} label={pipeline.label} />
      ) : (
        <Placeholder label={pipeline.label} description={pipeline.description} placeholderTail={t("placeholder")} />
      )}
    </div>
  );
}

function Header({
  pipelines, active, onChange, description, pageTitle, preparingBadge,
}: {
  pipelines: PipelineOption[];
  active: string;
  onChange: (id: string) => void;
  description: string;
  pageTitle: string;
  preparingBadge: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 }}>
      <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: "#f4f1fa" }}>
        {pageTitle}
      </h1>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {pipelines.map((p) => {
          const isActive = p.id === active;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onChange(p.id)}
              style={{
                padding: "8px 14px",
                borderRadius: 999,
                border: `1px solid ${isActive ? "#ffe600" : "#2c3140"}`,
                background: isActive ? "#ffe600" : "transparent",
                color: isActive ? "#131519" : "#e8ebf2",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600,
                opacity: p.available ? 1 : 0.55,
                display: "flex", alignItems: "center", gap: 6,
              }}
            >
              {p.label}
              {!p.available && <span style={{ fontSize: 10, fontWeight: 500 }}>({preparingBadge})</span>}
            </button>
          );
        })}
      </div>
      <p style={{ margin: 0, color: "#a8afbe", fontSize: 13, lineHeight: 1.6, maxWidth: 900 }}>
        {description}
      </p>
    </div>
  );
}

function Placeholder({ label, description, placeholderTail }: {
  label: string;
  description: string;
  placeholderTail: string;
}) {
  return (
    <div style={{
      minHeight: 400, background: "#0b0d11",
      border: "1px dashed #2c3140", borderRadius: 8,
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      color: "#7a8090", gap: 8, padding: 24, textAlign: "center",
    }}>
      <div style={{ fontSize: 14, color: "#e8ebf2" }}>{label}{placeholderTail}</div>
      <div style={{ fontSize: 12, maxWidth: 480 }}>{description}</div>
    </div>
  );
}

function LoadedViewer({ assets, label }: { assets: NonNullable<PipelineOption["assets"]>; label: string }) {
  const t = useTranslations("pages.sample");
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [trajectory, setTrajectory] = useState<TrajectoryData | null>(null);
  const [timeseries, setTimeseries] = useState<TimeSeriesData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSummary(null); setTrajectory(null); setTimeseries(null); setError(null);
    Promise.all([
      fetch(assets.summary).then((r) => r.json()),
      fetch(assets.trajectory).then((r) => r.json()),
      fetch(assets.timeseries).then((r) => r.json()),
    ])
      .then(([s, tr, ts]) => {
        if (cancelled) return;
        setSummary(s); setTrajectory(tr); setTimeseries(ts);
      })
      .catch((e) => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [assets.summary, assets.trajectory, assets.timeseries]);

  if (error) {
    return (
      <div style={{ color: "#ff3d80", padding: 24 }}>
        {t("loadError")}
      </div>
    );
  }

  if (!summary || !trajectory || !timeseries) {
    return (
      <div style={{ minHeight: 400, color: "#7a8090", padding: 24 }}>
        {t("loading")}
      </div>
    );
  }

  return (
    <TimeProvider durationSec={summary.durationSec}>
      <PanelGrid
        rgbUrl={assets.rgb}
        depthUrl={assets.depth}
        meshUrl={assets.mesh}
        trajectory={trajectory}
        timeseries={timeseries}
      />
      <TimelineBar />
      <SummaryBlock summary={summary} />
    </TimeProvider>
  );
}

function PanelGrid({
  rgbUrl, depthUrl, meshUrl, trajectory, timeseries,
}: {
  rgbUrl: string;
  depthUrl: string | null;
  meshUrl: string | null;
  trajectory: TrajectoryData;
  timeseries: TimeSeriesData;
}) {
  const t = useTranslations("pages.sample.panels");
  return (
    // 2x2: 上段 RGB / Depth、 下段 3D シーン / センサー。
    <div style={{
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 8,
      background: "#151820",
      borderRadius: 8,
      border: "1px solid #1a1d24",
      overflow: "hidden",
    }}>
      <PanelCell title={t("rgb")}>
        <RgbPanel src={rgbUrl} />
      </PanelCell>
      <PanelCell title={t("depth")}>
        <DepthPanel src={depthUrl} />
      </PanelCell>
      <PanelCell title={t("scene")} minHeight={320}>
        <ScenePanel meshUrl={meshUrl} trajectory={trajectory} />
      </PanelCell>
      <PanelCell title={t("numeric")} minHeight={320}>
        <NumericPanel data={timeseries} />
      </PanelCell>
    </div>
  );
}

function PanelCell({ title, children, minHeight }: {
  title: string;
  children: React.ReactNode;
  minHeight?: number;
}) {
  return (
    <div style={{
      background: "#0b0d11",
      display: "flex", flexDirection: "column",
      minHeight,
      minWidth: 0,   // grid セルが中身の intrinsic width で膨らむのを防ぐ (= 兄弟セルの潰れ防止)
    }}>
      <div style={{
        fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: "#7a8090",
        padding: "8px 12px", borderBottom: "1px solid #1a1d24",
      }}>
        {title}
      </div>
      <div style={{ flex: 1, display: "flex", minWidth: 0 }}>
        {children}
      </div>
    </div>
  );
}

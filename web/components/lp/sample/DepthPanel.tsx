"use client";

// Depth (LiDAR) をカラーマップ動画にしたパネル。 時刻は master (RGB) 由来なので、
// このコンポーネントは「時間を発信しない」 = 受信するだけ。
// - Store の t が動くたびに |v.currentTime - t| > 閾値なら video.currentTime を再セット
// - Store の playing に応じて play / pause
// - depth.mp4 が存在しないセッション (非 LiDAR) では null を返して隠す設計にしたいので、
//   src が null なら「収録なし」 表示を出す。

import { useEffect, useRef } from "react";
import { usePlayhead } from "./TimeContext";

const SYNC_TOLERANCE_S = 0.1;

interface Props {
  src: string | null;
  aspectRatio?: number;
}

export default function DepthPanel({ src, aspectRatio = 4 / 3 }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const state = usePlayhead();

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !src) return;
    const drift = Math.abs(v.currentTime - state.t);
    if (drift > SYNC_TOLERANCE_S) {
      v.currentTime = state.t;
    }
    if (state.playing && v.paused) v.play().catch(() => {});
    else if (!state.playing && !v.paused) v.pause();
  }, [state.t, state.playing, src]);

  if (!src) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        width: "100%", aspectRatio, background: "#0b0d11",
        color: "#666", fontSize: 12,
      }}>
        depth (LiDAR) 収録なし
      </div>
    );
  }

  return (
    <div style={{ position: "relative", width: "100%", aspectRatio, background: "#000" }}>
      <video
        ref={videoRef}
        src={src}
        preload="metadata"
        playsInline
        muted
        style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
      />
    </div>
  );
}

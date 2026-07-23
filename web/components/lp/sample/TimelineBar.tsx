"use client";

// 4 パネル共通のタイムラインスクラバ + 再生ボタン。
// - Track クリック / ドラッグで再生位置をシーク (RGB video → onSeeked 経由で他パネルにも伝搬)。
// - 再生ボタンは Store の playing をトグル。 RGB video 側が状態遷移を吸い上げる。
// - 表示は再生窓 (rangeStart..rangeEnd) 基準: バーは窓を 0..100% として描き、
//   時刻も窓先頭からの相対 mm:ss / 窓の長さで出す。 窓の外へはシークできない。

import { useCallback, useEffect, useRef } from "react";
import { usePlayhead, usePlayheadControls, usePlaying } from "./TimeContext";

function fmtSec(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, "0")}`;
}

export default function TimelineBar() {
  const state = usePlayhead();
  const playing = usePlaying();
  const { setTime, toggle } = usePlayheadControls();
  const trackRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  const seekToClientX = useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;  // レイアウト前の 0 幅で frac が NaN になるのを防ぐ
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    setTime(state.rangeStart + frac * (state.rangeEnd - state.rangeStart));
  }, [setTime, state.rangeStart, state.rangeEnd]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (draggingRef.current) seekToClientX(e.clientX);
    };
    const onUp = () => { draggingRef.current = false; };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [seekToClientX]);

  const span = state.rangeEnd - state.rangeStart;
  const frac = span > 0 ? Math.max(0, Math.min(1, (state.t - state.rangeStart) / span)) : 0;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12, padding: "10px 12px",
      background: "#0b0d11", color: "#e8ebf2", borderTop: "1px solid #1a1d24",
    }}>
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pause" : "Play"}
        style={{
          width: 36, height: 36, borderRadius: 6, border: "1px solid #2c3140",
          background: "#151820", color: "#e8ebf2", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 14, padding: 0,
        }}
      >
        {playing ? "⏸" : "▶"}
      </button>
      <div
        ref={trackRef}
        onPointerDown={(e) => {
          draggingRef.current = true;
          seekToClientX(e.clientX);
        }}
        style={{
          flex: 1, height: 8, background: "#1a1d24", borderRadius: 4, position: "relative",
          cursor: "pointer",
        }}
      >
        <div style={{
          position: "absolute", left: 0, top: 0, bottom: 0,
          width: `${frac * 100}%`, background: "#ffe600", borderRadius: 4,
        }} />
        <div style={{
          position: "absolute", left: `${frac * 100}%`, top: -4, width: 16, height: 16,
          background: "#fff", borderRadius: 8, transform: "translateX(-8px)",
          boxShadow: "0 0 0 2px #ffe600",
        }} />
      </div>
      <div style={{
        fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 12,
        minWidth: 88, textAlign: "right", fontVariantNumeric: "tabular-nums",
      }}>
        {fmtSec(state.t - state.rangeStart)} / {fmtSec(span)}
      </div>
    </div>
  );
}

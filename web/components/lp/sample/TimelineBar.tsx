"use client";

// 4 パネル共通のタイムラインスクラバ + 再生ボタン。
// - Track クリック / ドラッグで再生位置をシーク (RGB video → onSeeked 経由で他パネルにも伝搬)。
// - 再生ボタンは Store の playing をトグル。 RGB video 側が状態遷移を吸い上げる。
// - バーはクリップ全長 (0..durationSec) を描き、 再生窓 (rangeStart..rangeEnd) だけを
//   明るい操作可能セグメントとして見せる = 「全体の一部だけ公開している」 ことが伝わる。
//   時刻表示も絶対時刻 / 全長。 窓の外をクリックしても Store 側のクランプで窓端に収まる。

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
    setTime(frac * state.durationSec);  // 窓の外は Store のクランプで最寄りの窓端に落ちる
  }, [setTime, state.durationSec]);

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

  const dur = state.durationSec;
  const fracT = dur > 0 ? Math.max(0, Math.min(1, state.t / dur)) : 0;
  const fracStart = dur > 0 ? state.rangeStart / dur : 0;
  const fracEnd = dur > 0 ? state.rangeEnd / dur : 1;

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
        {/* 再生窓 = 操作できる明るいセグメント。 外側は暗いままにして「ここは公開範囲外」を示す。 */}
        <div style={{
          position: "absolute", left: `${fracStart * 100}%`, top: 0, bottom: 0,
          width: `${(fracEnd - fracStart) * 100}%`, background: "#3a4152", borderRadius: 4,
        }} />
        <div style={{
          position: "absolute", left: `${fracStart * 100}%`, top: 0, bottom: 0,
          width: `${Math.max(0, fracT - fracStart) * 100}%`, background: "#ffe600", borderRadius: 4,
        }} />
        <div style={{
          position: "absolute", left: `${fracT * 100}%`, top: -4, width: 16, height: 16,
          background: "#fff", borderRadius: 8, transform: "translateX(-8px)",
          boxShadow: "0 0 0 2px #ffe600",
        }} />
      </div>
      <div style={{
        fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 12,
        minWidth: 88, textAlign: "right", fontVariantNumeric: "tabular-nums",
      }}>
        {fmtSec(state.t)} / {fmtSec(dur)}
      </div>
    </div>
  );
}

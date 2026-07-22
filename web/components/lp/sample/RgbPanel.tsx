"use client";

// RGB video パネル。 4 パネルの中で唯一「時間の真実」 を持つ master コンポーネント。
// - <video> の currentTime を rAF で共通 Store に発信する (時間 → 他パネルへ)。
// - 共通 Store の再生ヘッド (setTime / setPlaying) を購読して、 スクラバ操作や外部
//   一時停止で video を巻き戻し / 再開する (時間 ← Store)。
// - 双方向にすると小さな setCurrentTime ループが起きるので、 「video からの通知」 と
//   「Store からの押し戻し」 を drift 100ms 閾値で切り分ける (下参照)。

import { useEffect, useRef } from "react";
import { usePlayheadControls, usePlayhead } from "./TimeContext";

const SYNC_TOLERANCE_S = 0.1;  // Store と video の乖離がこれを超えたら seek で強制同期

interface Props {
  src: string;
  aspectRatio?: number;  // width / height (px 比)。 fallback は 4:3
}

export default function RgbPanel({ src, aspectRatio = 4 / 3 }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const { setTime, setPlaying } = usePlayheadControls();
  const state = usePlayhead();

  // video → Store: 再生中は rAF で currentTime を吸い上げる。 一時停止中は onSeeked のみ。
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let raf = 0;
    const tick = () => {
      if (!v.paused && !v.seeking) setTime(v.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [setTime]);

  // video の状態変化 (Play/Pause/Ended) を Store の playing に反映。
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => setPlaying(false);
    const onSeeked = () => setTime(v.currentTime);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("ended", onEnded);
    v.addEventListener("seeked", onSeeked);
    return () => {
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("ended", onEnded);
      v.removeEventListener("seeked", onSeeked);
    };
  }, [setPlaying, setTime]);

  // Store → video: 外部から時刻を書き換えられた (スクラバ操作) 時に seek で追従。
  // 自分自身の rAF 由来の更新は tolerance の内側なので発火しない (= フィードバックループ回避)。
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const drift = Math.abs(v.currentTime - state.t);
    if (drift > SYNC_TOLERANCE_S) {
      v.currentTime = state.t;
    }
    if (state.playing && v.paused) v.play().catch(() => {});
    else if (!state.playing && !v.paused) v.pause();
  }, [state.t, state.playing]);

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

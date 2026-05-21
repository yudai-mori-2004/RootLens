"use client";
import { useRef, useCallback } from "react";
import s from "./lp.module.css";

export function SyncedVideoPair({
  videoSrc,
  skeletonSrc,
}: {
  videoSrc: string;
  skeletonSrc: string;
}) {
  const rgbRef = useRef<HTMLVideoElement>(null);
  const skelRef = useRef<HTMLVideoElement>(null);

  const syncTime = useCallback(() => {
    const rgb = rgbRef.current;
    const skel = skelRef.current;
    if (rgb && skel) {
      skel.currentTime = rgb.currentTime;
    }
  }, []);

  const handlePlay = useCallback(() => {
    syncTime();
    skelRef.current?.play();
  }, [syncTime]);

  const handlePause = useCallback(() => {
    skelRef.current?.pause();
    syncTime();
  }, [syncTime]);

  const handleTimeUpdate = useCallback(() => {
    const rgb = rgbRef.current;
    const skel = skelRef.current;
    if (rgb && skel && Math.abs(rgb.currentTime - skel.currentTime) > 0.15) {
      skel.currentTime = rgb.currentTime;
    }
  }, []);

  return (
    <div className={s.episodeVideos}>
      <div className={s.episodeVideoWrap}>
        <video
          ref={rgbRef}
          controls
          preload="metadata"
          playsInline
          className={s.episodeVideo}
          src={videoSrc}
          onPlay={handlePlay}
          onPause={handlePause}
          onSeeked={syncTime}
          onTimeUpdate={handleTimeUpdate}
        />
      </div>
      <div className={s.episodeSkeletonWrap}>
        <video
          ref={skelRef}
          preload="metadata"
          playsInline
          muted
          className={s.episodeSkeleton}
          src={skeletonSrc}
        />
      </div>
    </div>
  );
}

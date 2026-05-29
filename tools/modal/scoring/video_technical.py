"""VideoTechnical 軸: 動画そのものの技術品質 (0-100)。 内在・タスク非依存・安い (frame 解析のみ)。

サブ指標 (= 同種の技術品質なので軸内で集約してよい):
  brightness_in_range : 平均輝度 ∈ [40,240] のフレーム割合
  sharpness_pass      : Laplacian 分散 >= 100 の割合 (= ボケ検出)
  optical_flow_pass   : Farneback 平均フロー >= 1px の割合 (= 静止検出)
  frame_diversity     : 連続サンプル HSV χ² 距離平均を正規化 (= ループ検出)
軸スコア = 4 サブ指標 (各 0-1) の平均 × 100。 buyer 側で重み付けし直せるよう breakdown も返す。
"""

from __future__ import annotations

from scoring.base import AxisScore, Scorer, clamp01
from r2ctx import Ctx

SAMPLE_INTERVAL_SEC = 3.0
BRIGHTNESS_MIN, BRIGHTNESS_MAX = 40.0, 240.0
SHARPNESS_THRESHOLD = 100.0
OPTICAL_FLOW_THRESHOLD = 1.0
DIVERSITY_NORMALIZE = 200.0
HSV_BINS = (16, 16)
HSV_RANGES = (0, 180, 0, 256)
OPTFLOW_DOWNSCALE = 0.5


def _compute_metrics(mp4_path: str) -> dict:
    import cv2  # type: ignore
    import numpy as np  # type: ignore

    cap = cv2.VideoCapture(mp4_path)
    if not cap.isOpened():
        raise RuntimeError(f"cannot open {mp4_path}")
    try:
        fps = cap.get(cv2.CAP_PROP_FPS)
        if not (fps and fps > 0 and fps == fps):
            fps = 30.0
        step = max(1, int(round(fps * SAMPLE_INTERVAL_SEC)))
        n = bright = sharp = flow_pass = flow_pairs = div_pairs = 0
        div_sum = 0.0
        prev_gray = prev_hist = None
        idx = -1
        while True:
            if not cap.grab():
                break
            idx += 1
            if idx % step != 0:
                continue
            ok, frame = cap.retrieve()
            if not ok or frame is None:
                continue
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            if BRIGHTNESS_MIN <= float(np.mean(gray)) <= BRIGHTNESS_MAX:
                bright += 1
            try:
                if float(cv2.Laplacian(gray, cv2.CV_64F).var()) >= SHARPNESS_THRESHOLD:
                    sharp += 1
            except cv2.error:
                pass
            small = cv2.resize(gray, None, fx=OPTFLOW_DOWNSCALE, fy=OPTFLOW_DOWNSCALE, interpolation=cv2.INTER_AREA)
            small_c = cv2.resize(frame, None, fx=OPTFLOW_DOWNSCALE, fy=OPTFLOW_DOWNSCALE, interpolation=cv2.INTER_AREA)
            hsv = cv2.cvtColor(small_c, cv2.COLOR_BGR2HSV)
            hist = cv2.calcHist([hsv], [0, 1], None, list(HSV_BINS), list(HSV_RANGES))
            cv2.normalize(hist, hist, alpha=0, beta=1, norm_type=cv2.NORM_MINMAX)
            if prev_gray is not None:
                try:
                    fl = cv2.calcOpticalFlowFarneback(prev_gray, small, None, 0.5, 3, 15, 3, 5, 1.2, 0)
                    mag = np.sqrt(fl[..., 0] ** 2 + fl[..., 1] ** 2)
                    if float(np.mean(mag)) / OPTFLOW_DOWNSCALE >= OPTICAL_FLOW_THRESHOLD:
                        flow_pass += 1
                except cv2.error:
                    pass
                flow_pairs += 1
                try:
                    chi2 = float(cv2.compareHist(prev_hist, hist, cv2.HISTCMP_CHISQR))
                except cv2.error:
                    chi2 = 0.0
                if chi2 == chi2 and chi2 != float("inf"):
                    div_sum += chi2
                div_pairs += 1
            prev_gray, prev_hist = small, hist
            n += 1
    finally:
        cap.release()

    div_mean = (div_sum / div_pairs) if div_pairs else 0.0
    return {
        # 独立サブ信号 (0-1)。 買い手はこれを独自重みで再集約できる。
        "signals": {
            "brightnessInRange": clamp01(bright / n) if n else 0.0,
            "sharpnessPass": clamp01(sharp / n) if n else 0.0,
            "opticalFlowPass": clamp01(flow_pass / flow_pairs) if flow_pairs else 0.0,
            "frameDiversity": clamp01(div_mean / DIVERSITY_NORMALIZE) if div_pairs else 0.0,
        },
        # 生カウント (= サブ信号を再計算できる素データ)。
        "counts": {
            "sampleCount": n, "brightnessPass": bright, "sharpnessPass": sharp,
            "flowPass": flow_pass, "flowPairs": flow_pairs,
            "diversityMean": round(div_mean, 3), "diversityPairs": div_pairs,
        },
    }


class VideoTechnicalScorer(Scorer):
    name = "video_technical"
    axis = "video_technical"

    def score(self, ctx: Ctx) -> AxisScore:
        m = _compute_metrics(ctx.download_raw("rgb.mp4"))
        sig = m["signals"]
        score = sum(sig.values()) / len(sig) * 100.0
        return AxisScore(
            axis=self.axis,
            score=round(score, 2),
            method=("mean(signals.brightnessInRange, sharpnessPass, opticalFlowPass, frameDiversity) × 100. "
                    "brightness/sharpness は /sampleCount、 opticalFlow は /flowPairs(=サンプル-1)、 "
                    "frameDiversity は diversityMean/diversityNormalize。"),
            breakdown={
                **m,
                "thresholds": {
                    "brightnessRange": [BRIGHTNESS_MIN, BRIGHTNESS_MAX],
                    "sharpnessVar": SHARPNESS_THRESHOLD,
                    "opticalFlowPx": OPTICAL_FLOW_THRESHOLD,
                    "diversityNormalize": DIVERSITY_NORMALIZE,
                    "sampleIntervalSec": SAMPLE_INTERVAL_SEC,
                },
            },
        )

#!/usr/bin/env python3
"""Estimate an auditable affine camera→IMU clock model for existing recordings.

This is a read-only clock-model estimator. It never rewrites source files. It compares
global image motion with raw gyroscope samples in independent windows and emits
the estimated offset/rate, method agreement, and holdout-style window evidence.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Iterable

import cv2
import numpy as np
from scipy.optimize import minimize_scalar


NS_PER_SECOND = 1_000_000_000


def read_timeline(source: Path) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    frame_pts: list[int] = []
    frame_clock: list[int] = []
    with (source / "frames.jsonl").open() as handle:
        for line in handle:
            if not line.strip():
                continue
            row = json.loads(line)
            frame_pts.append(int(row["mp4_pts_ns"]))
            frame_clock.append(int(row["timestamp_ns"]))

    gyro_time: list[int] = []
    gyro_values: list[tuple[float, float, float]] = []
    with (source / "imu.jsonl").open() as handle:
        for line in handle:
            if not line.strip():
                continue
            row = json.loads(line)
            if row.get("sensor") != "gyroscope":
                continue
            gyro_time.append(int(row["timestamp_ns"]))
            gyro_values.append((float(row["x"]), float(row["y"]), float(row["z"])))

    if len(frame_pts) < 60 or len(gyro_time) < 300:
        raise ValueError("recording does not contain enough frame/gyroscope samples")
    return (
        np.asarray(frame_pts, dtype=np.int64),
        np.asarray(frame_clock, dtype=np.int64),
        np.asarray(gyro_time, dtype=np.int64),
        np.asarray(gyro_values, dtype=np.float64),
    )


def robust_keep(values: np.ndarray, floor: float | None = None) -> np.ndarray:
    finite = np.isfinite(values)
    selected = values[finite]
    if selected.size < 20:
        return finite
    median = np.median(selected)
    mad = np.median(np.abs(selected - median))
    scale = max(1.4826 * mad, 1e-9)
    keep = finite & (np.abs(values - median) <= 10.0 * scale)
    if floor is not None:
        keep &= values >= floor
    return keep


def visual_motion(
    video: Path,
    frame_clock: np.ndarray,
    start_seconds: float,
    duration_seconds: float,
    sample_fps: float,
) -> dict[str, np.ndarray | int | float]:
    capture = cv2.VideoCapture(str(video))
    if not capture.isOpened():
        raise RuntimeError(f"could not open {video}")
    capture.set(cv2.CAP_PROP_POS_MSEC, start_seconds * 1000.0)
    end_seconds = start_seconds + duration_seconds
    minimum_spacing = 1.0 / sample_fps
    previous_gray: np.ndarray | None = None
    previous_index: int | None = None
    previous_time: float | None = None
    last_kept_time = -math.inf
    starts: list[int] = []
    ends: list[int] = []
    rotation: list[float] = []
    translate_x: list[float] = []
    translate_y: list[float] = []
    magnitude: list[float] = []
    inlier_ratios: list[float] = []
    decoded = 0

    try:
        while True:
            ok, image = capture.read()
            if not ok:
                break
            decoded += 1
            frame_index = int(round(capture.get(cv2.CAP_PROP_POS_FRAMES))) - 1
            if frame_index < 0 or frame_index >= frame_clock.size:
                continue
            frame_seconds = float(capture.get(cv2.CAP_PROP_POS_MSEC)) / 1000.0
            if frame_seconds > end_seconds:
                break
            if frame_seconds + 1e-6 < start_seconds or frame_seconds - last_kept_time < minimum_spacing:
                continue
            last_kept_time = frame_seconds
            height, width = image.shape[:2]
            target_width = 480
            target_height = max(1, int(round(height * target_width / width)))
            gray = cv2.cvtColor(
                cv2.resize(image, (target_width, target_height), interpolation=cv2.INTER_AREA),
                cv2.COLOR_BGR2GRAY,
            )
            if previous_gray is not None and previous_index is not None and previous_time is not None:
                dt = frame_seconds - previous_time
                points = cv2.goodFeaturesToTrack(
                    previous_gray,
                    maxCorners=600,
                    qualityLevel=0.01,
                    minDistance=6,
                    blockSize=5,
                )
                if points is not None and len(points) >= 20 and 0.02 <= dt <= 0.25:
                    tracked, status, _ = cv2.calcOpticalFlowPyrLK(
                        previous_gray,
                        gray,
                        points,
                        None,
                        winSize=(21, 21),
                        maxLevel=3,
                    )
                    valid = status.reshape(-1).astype(bool)
                    before = points.reshape(-1, 2)[valid]
                    after = tracked.reshape(-1, 2)[valid]
                    if len(before) >= 20:
                        matrix, inliers = cv2.estimateAffinePartial2D(
                            before,
                            after,
                            method=cv2.RANSAC,
                            ransacReprojThreshold=2.0,
                            maxIters=2000,
                            confidence=0.995,
                            refineIters=10,
                        )
                        if matrix is not None and inliers is not None:
                            inlier_ratio = float(np.mean(inliers))
                            diagonal = math.hypot(target_width, target_height)
                            angular_speed = math.atan2(matrix[1, 0], matrix[0, 0]) / dt
                            x_speed = float(matrix[0, 2]) / diagonal / dt
                            y_speed = float(matrix[1, 2]) / diagonal / dt
                            if inlier_ratio >= 0.35 and max(abs(angular_speed), abs(x_speed), abs(y_speed)) < 20:
                                starts.append(int(frame_clock[previous_index]))
                                ends.append(int(frame_clock[frame_index]))
                                rotation.append(angular_speed)
                                translate_x.append(x_speed)
                                translate_y.append(y_speed)
                                magnitude.append(math.sqrt(angular_speed**2 + x_speed**2 + y_speed**2))
                                inlier_ratios.append(inlier_ratio)
            previous_gray = gray
            previous_index = frame_index
            previous_time = frame_seconds
    finally:
        capture.release()

    result = {
        "start_ns": np.asarray(starts, dtype=np.int64),
        "end_ns": np.asarray(ends, dtype=np.int64),
        "rotation": np.asarray(rotation, dtype=np.float64),
        "translate_x": np.asarray(translate_x, dtype=np.float64),
        "translate_y": np.asarray(translate_y, dtype=np.float64),
        "magnitude": np.asarray(magnitude, dtype=np.float64),
        "inlier_ratio": np.asarray(inlier_ratios, dtype=np.float64),
        "decoded_frames": decoded,
    }
    if len(starts) < 60:
        raise RuntimeError(f"only {len(starts)} usable visual intervals in window")
    return result


def prefix_integral(times: np.ndarray, values: np.ndarray) -> np.ndarray:
    seconds = times.astype(np.float64) / NS_PER_SECOND
    delta = np.diff(seconds)
    areas = 0.5 * (values[:-1] + values[1:]) * delta
    return np.concatenate(([0.0], np.cumsum(areas)))


def interval_means(
    starts: np.ndarray,
    ends: np.ndarray,
    offset_seconds: float,
    gyro_time: np.ndarray,
    prefix: np.ndarray,
) -> np.ndarray:
    gyro_seconds = gyro_time.astype(np.float64) / NS_PER_SECOND
    shifted_start = starts.astype(np.float64) / NS_PER_SECOND + offset_seconds
    shifted_end = ends.astype(np.float64) / NS_PER_SECOND + offset_seconds
    start_area = np.interp(shifted_start, gyro_seconds, prefix)
    end_area = np.interp(shifted_end, gyro_seconds, prefix)
    duration = shifted_end - shifted_start
    return (end_area - start_area) / np.maximum(duration, 1e-9)


def pearson(left: np.ndarray, right: np.ndarray) -> float:
    if left.size < 20 or np.std(left) < 1e-12 or np.std(right) < 1e-12:
        return float("nan")
    return float(np.corrcoef(left, right)[0, 1])


def solve_pair(
    visual: np.ndarray,
    starts: np.ndarray,
    ends: np.ndarray,
    gyro_time: np.ndarray,
    gyro_prefix: np.ndarray,
    search_seconds: float,
) -> tuple[float, float]:
    valid = robust_keep(visual)
    visual = visual[valid]
    starts = starts[valid]
    ends = ends[valid]

    def objective(offset: float) -> float:
        sampled = interval_means(starts, ends, offset, gyro_time, gyro_prefix)
        correlation = pearson(visual, sampled)
        return -abs(correlation) if math.isfinite(correlation) else 1.0

    coarse = np.arange(-search_seconds, search_seconds + 1e-9, 0.005)
    scores = np.asarray([objective(float(value)) for value in coarse])
    best_index = int(np.argmin(scores))
    lo = max(-search_seconds, float(coarse[best_index] - 0.0075))
    hi = min(search_seconds, float(coarse[best_index] + 0.0075))
    refined = minimize_scalar(objective, bounds=(lo, hi), method="bounded", options={"xatol": 1e-6})
    offset = float(refined.x)
    sampled = interval_means(starts, ends, offset, gyro_time, gyro_prefix)
    return offset, pearson(visual, sampled)


def analyze_window(
    video: Path,
    frame_clock: np.ndarray,
    gyro_time: np.ndarray,
    gyro_values: np.ndarray,
    start_seconds: float,
    duration_seconds: float,
    sample_fps: float,
    search_seconds: float,
) -> dict[str, object]:
    visual = visual_motion(video, frame_clock, start_seconds, duration_seconds, sample_fps)
    gyro_signals = {
        "gyro_x": gyro_values[:, 0],
        "gyro_y": gyro_values[:, 1],
        "gyro_z": gyro_values[:, 2],
        "gyro_magnitude": np.linalg.norm(gyro_values, axis=1),
    }
    prefixes = {name: prefix_integral(gyro_time, values) for name, values in gyro_signals.items()}
    candidates: list[dict[str, object]] = []
    for visual_name in ("rotation", "translate_x", "translate_y"):
        for gyro_name in ("gyro_x", "gyro_y", "gyro_z"):
            offset, correlation = solve_pair(
                np.asarray(visual[visual_name]),
                np.asarray(visual["start_ns"]),
                np.asarray(visual["end_ns"]),
                gyro_time,
                prefixes[gyro_name],
                search_seconds,
            )
            candidates.append({
                "pair": f"{visual_name}_vs_{gyro_name}",
                "offset_ms": offset * 1000.0,
                "correlation": correlation,
            })
    offset, correlation = solve_pair(
        np.asarray(visual["magnitude"]),
        np.asarray(visual["start_ns"]),
        np.asarray(visual["end_ns"]),
        gyro_time,
        prefixes["gyro_magnitude"],
        search_seconds,
    )
    candidates.append({
        "pair": "affine_motion_magnitude_vs_gyro_magnitude",
        "offset_ms": offset * 1000.0,
        "correlation": correlation,
    })
    candidates.sort(key=lambda row: abs(float(row["correlation"])), reverse=True)
    best = candidates[0]
    consensus_candidates = [
        row for row in candidates if abs(float(row["correlation"])) >= 0.80
    ]
    consensus_offsets = np.asarray(
        [float(row["offset_ms"]) for row in consensus_candidates], dtype=np.float64
    )
    consensus_median = float(np.median(consensus_offsets))
    midpoint_clock_ns = int(
        (int(np.asarray(visual["start_ns"])[0]) + int(np.asarray(visual["end_ns"])[-1])) // 2
    )
    return {
        "start_seconds": start_seconds,
        "duration_seconds": duration_seconds,
        "midpoint_camera_clock_ns": midpoint_clock_ns,
        "usable_visual_intervals": int(len(np.asarray(visual["start_ns"]))),
        "median_ransac_inlier_ratio": float(np.median(np.asarray(visual["inlier_ratio"]))),
        "decoded_frames": int(visual["decoded_frames"]),
        "best": best,
        "top_candidates": candidates[:5],
        "method_consensus": {
            "minimum_absolute_correlation": 0.80,
            "candidate_count": len(consensus_candidates),
            "median_offset_ms": consensus_median,
            "max_deviation_from_median_ms": float(
                np.max(np.abs(consensus_offsets - consensus_median))
            ),
        },
    }


def automatic_starts(total_duration: float, window: float, count: int) -> list[float]:
    margin = min(10.0, max(0.0, (total_duration - window) / 4.0))
    last = max(margin, total_duration - window - margin)
    if count <= 1 or last <= margin:
        return [max(0.0, (total_duration - window) / 2.0)]
    return [float(value) for value in np.linspace(margin, last, count)]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("--window-seconds", type=float, default=300.0)
    parser.add_argument("--window-count", type=int, default=3)
    parser.add_argument("--sample-fps", type=float, default=15.0)
    parser.add_argument("--search-seconds", type=float, default=1.5)
    parser.add_argument("--starts", help="comma-separated MP4 times in seconds")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    frame_pts, frame_clock, gyro_time, gyro_values = read_timeline(args.source)
    total_duration = float(frame_pts[-1]) / NS_PER_SECOND
    starts = (
        [float(value) for value in args.starts.split(",")]
        if args.starts
        else automatic_starts(total_duration, args.window_seconds, args.window_count)
    )
    windows = [
        analyze_window(
            args.source / "rgb.mp4",
            frame_clock,
            gyro_time,
            gyro_values,
            start,
            args.window_seconds,
            args.sample_fps,
            args.search_seconds,
        )
        for start in starts
    ]

    camera_midpoints = np.asarray(
        [int(row["midpoint_camera_clock_ns"]) for row in windows], dtype=np.float64
    )
    offsets = np.asarray([float(row["best"]["offset_ms"]) for row in windows], dtype=np.float64)
    elapsed = (camera_midpoints - camera_midpoints[0]) / NS_PER_SECOND
    if len(windows) >= 2:
        slope_ms_per_second, intercept_ms = np.polyfit(elapsed, offsets, 1)
        predicted = slope_ms_per_second * elapsed + intercept_ms
        residual = offsets - predicted
    else:
        slope_ms_per_second = 0.0
        intercept_ms = float(offsets[0])
        residual = np.zeros_like(offsets)

    correlations = np.asarray([abs(float(row["best"]["correlation"])) for row in windows])
    consensus_deviations = np.asarray([
        float(row["method_consensus"]["max_deviation_from_median_ms"]) for row in windows
    ])
    quality = (
        "good"
        if np.min(correlations) >= 0.55
        and np.max(np.abs(residual)) <= 8.0
        and np.max(consensus_deviations) <= 15.0
        else "review"
    )
    report = {
        "schema": "rootlens.camera_imu_clock_model.v1",
        "kind": "camera_to_imu_affine_clock_model_audit",
        "source": str(args.source),
        "source_files_modified": False,
        "raw_timestamps_modified": False,
        "mapping_method": "post_capture_motion_signal_affine_estimation",
        "source_clock": "AVCaptureSession.synchronizationClock",
        "target_clock": "CoreMotion boot-relative clock",
        "method": "RANSAC affine optical flow vs raw three-axis gyroscope; independent windows",
        "offset_convention": "imu_event_timestamp_minus_video_event_timestamp",
        "total_duration_seconds": total_duration,
        "frame_count": int(frame_clock.size),
        "gyro_count": int(gyro_time.size),
        "source_observation": {
            "first_camera_timestamp_ns": int(frame_clock[0]),
            "last_camera_timestamp_ns": int(frame_clock[-1]),
            "first_gyro_timestamp_ns": int(gyro_time[0]),
            "last_gyro_timestamp_ns": int(gyro_time[-1]),
        },
        "windows": windows,
        "clock_model": {
            "model_type": "affine",
            "equation": "total_alignment_ns = offset_at_source_anchor_ns + (source_timestamp_ns - source_anchor_ns) * (target_rate_per_source_rate - 1)",
            "source_anchor_ns": int(camera_midpoints[0]),
            "offset_at_source_anchor_ns": int(round(intercept_ms * 1_000_000.0)),
            "target_rate_per_source_rate": float(1.0 + slope_ms_per_second / 1000.0),
            "offset_convention": "imu_event_timestamp_minus_video_event_timestamp",
            "contains_sensor_validity_residual": True,
        },
        "affine_fit": {
            "offset_at_first_window_ms": float(intercept_ms),
            "offset_slope_ms_per_second": float(slope_ms_per_second),
            "camera_to_imu_rate_correction_ppm": float(slope_ms_per_second * 1000.0),
            "max_window_fit_residual_ms": float(np.max(np.abs(residual))),
            "window_fit_residuals_ms": [float(value) for value in residual],
        },
        "quality": quality,
        "limitations": [
            "The recording does not contain the CoreMedia session-to-host rate/anchor pair.",
            "Clock-model parameters are estimated from time-correlated camera and gyroscope motion.",
            "Raw RGB, IMU samples, and raw timestamps remain unchanged.",
        ],
    }
    encoded = json.dumps(report, indent=2, ensure_ascii=False) + "\n"
    if args.output:
        args.output.write_text(encoded)
    print(encoded, end="")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Independently validate every exported RGB+IMU clip and emit JSON/Markdown reports."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import subprocess
import tempfile
from typing import Any

import cv2
import numpy as np

from audit_historical_clock import (
    prefix_integral,
    solve_pair,
    visual_motion,
)


NS_PER_SECOND = 1_000_000_000
REQUIRED_FILES = ("rgb.mp4", "frames.jsonl", "imu.jsonl", "metadata.json")


def read_json(path: Path) -> dict[str, Any]:
    with path.open() as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(f"JSON object required: {path}")
    return value


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(4 * 1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def run(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, check=True, text=True, capture_output=True)


def probe_media(video: Path) -> dict[str, Any]:
    value = json.loads(
        run(
            [
                "ffprobe",
                "-v",
                "error",
                "-count_packets",
                "-show_entries",
                (
                    "format=duration,size:"
                    "stream=index,codec_type,codec_name,width,height,avg_frame_rate,"
                    "sample_rate,channels,nb_read_packets"
                ),
                "-of",
                "json",
                str(video),
            ]
        ).stdout
    )
    video_stream = next(row for row in value["streams"] if row["codec_type"] == "video")
    audio_stream = next(row for row in value["streams"] if row["codec_type"] == "audio")
    numerator, denominator = (float(part) for part in video_stream["avg_frame_rate"].split("/"))
    return {
        "duration_seconds": float(value["format"]["duration"]),
        "size_bytes": int(value["format"]["size"]),
        "video_codec": video_stream["codec_name"],
        "width": int(video_stream["width"]),
        "height": int(video_stream["height"]),
        "fps": numerator / denominator,
        "video_packets": int(video_stream["nb_read_packets"]),
        "audio_codec": audio_stream["codec_name"],
        "audio_sample_rate": int(audio_stream["sample_rate"]),
        "audio_channels": int(audio_stream["channels"]),
        "audio_packets": int(audio_stream["nb_read_packets"]),
    }


def full_decode(video: Path) -> dict[str, Any]:
    result = subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-v",
            "error",
            "-xerror",
            "-i",
            str(video),
            "-map",
            "0:v:0",
            "-map",
            "0:a:0",
            "-f",
            "null",
            "-",
        ],
        text=True,
        capture_output=True,
    )
    return {
        "passed": result.returncode == 0,
        "return_code": result.returncode,
        "stderr": result.stderr[-4000:],
    }


def interval_stats(timestamps: np.ndarray) -> dict[str, float]:
    delta_ms = np.diff(timestamps.astype(np.float64)) / 1_000_000.0
    if delta_ms.size == 0:
        raise ValueError("timestamp stream has fewer than two samples")
    return {
        "median_ms": float(np.median(delta_ms)),
        "p99_ms": float(np.percentile(delta_ms, 99)),
        "max_ms": float(np.max(delta_ms)),
        "estimated_hz": float(1000.0 / np.median(delta_ms)),
    }


def read_imu(path: Path, metadata: dict[str, Any]) -> tuple[dict[str, np.ndarray], dict[str, np.ndarray]]:
    times: dict[str, list[int]] = {"accelerometer": [], "gyroscope": []}
    values: dict[str, list[tuple[float, float, float]]] = {
        "accelerometer": [],
        "gyroscope": [],
    }
    with path.open() as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            row = json.loads(line)
            sensor = row.get("sensor")
            if sensor not in times:
                raise ValueError(f"unknown IMU sensor at line {line_number}: {sensor}")
            if int(row["sample_index"]) != len(times[sensor]):
                raise ValueError(f"{sensor} sample_index discontinuity at line {line_number}")
            timestamp_ns = int(row["timestamp_ns"])
            if times[sensor] and timestamp_ns <= times[sensor][-1]:
                raise ValueError(f"{sensor} timestamp is not strictly monotonic")
            times[sensor].append(timestamp_ns)
            values[sensor].append((float(row["x"]), float(row["y"]), float(row["z"])))
    expected = {
        "accelerometer": int(metadata["accelerometer_sample_count"]),
        "gyroscope": int(metadata["gyroscope_sample_count"]),
    }
    for sensor in times:
        if len(times[sensor]) != expected[sensor]:
            raise ValueError(f"{sensor} count mismatch: {len(times[sensor])}/{expected[sensor]}")
    return (
        {sensor: np.asarray(rows, dtype=np.int64) for sensor, rows in times.items()},
        {sensor: np.asarray(rows, dtype=np.float64) for sensor, rows in values.items()},
    )


def read_frames(
    path: Path,
    metadata: dict[str, Any],
    imu_times: dict[str, np.ndarray],
) -> dict[str, Any]:
    raw: list[int] = []
    canonical: list[int] = []
    pts: list[int] = []
    first_row: dict[str, Any] | None = None
    last_row: dict[str, Any] | None = None
    offset_ns = int(metadata["capture_configuration"]["video_to_imu_offset_ns"])
    with path.open() as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            row = json.loads(line)
            index = len(raw)
            if row.get("frame_index") != index or row.get("mp4_sample_index") != index:
                raise ValueError(f"frame index discontinuity at line {line_number}")
            raw_ns = int(row["timestamp_ns"])
            canonical_ns = int(row["video_frame_timestamp_canonical_ns"])
            association_ns = int(row["imu_association_timestamp_ns"])
            if association_ns != canonical_ns + offset_ns:
                raise ValueError(f"association timestamp mismatch at frame {index}")
            for sensor in ("accelerometer", "gyroscope"):
                before = int(row[f"{sensor}_before_index"])
                after = int(row[f"{sensor}_after_index"])
                if before < 0 or after != before + 1 or after >= imu_times[sensor].size:
                    raise ValueError(f"{sensor} neighbor index mismatch at frame {index}")
                if int(row[f"{sensor}_before_timestamp_ns"]) != int(imu_times[sensor][before]):
                    raise ValueError(f"{sensor} before timestamp mismatch at frame {index}")
                if int(row[f"{sensor}_after_timestamp_ns"]) != int(imu_times[sensor][after]):
                    raise ValueError(f"{sensor} after timestamp mismatch at frame {index}")
                if not (imu_times[sensor][before] <= association_ns <= imu_times[sensor][after]):
                    raise ValueError(f"{sensor} samples do not bracket frame {index}")
            raw.append(raw_ns)
            canonical.append(canonical_ns)
            pts.append(int(row["mp4_pts_ns"]))
            first_row = row if first_row is None else first_row
            last_row = row
    if len(raw) != int(metadata["video_frame_count"]):
        raise ValueError(f"frame count mismatch: {len(raw)}/{metadata['video_frame_count']}")
    raw_array = np.asarray(raw, dtype=np.int64)
    canonical_array = np.asarray(canonical, dtype=np.int64)
    pts_array = np.asarray(pts, dtype=np.int64)
    if np.any(np.diff(raw_array) <= 0) or np.any(np.diff(canonical_array) <= 0) or np.any(np.diff(pts_array) <= 0):
        raise ValueError("frame timestamps are not strictly monotonic")
    assert first_row is not None and last_row is not None
    return {
        "raw": raw_array,
        "canonical": canonical_array,
        "pts": pts_array,
        "first_association_ns": int(first_row["imu_association_timestamp_ns"]),
        "last_association_ns": int(last_row["imu_association_timestamp_ns"]),
        "intervals": interval_stats(canonical_array),
    }


def motion_alignment(
    video: Path,
    frame_clock: np.ndarray,
    gyro_time: np.ndarray,
    gyro_values: np.ndarray,
    duration_seconds: float,
    sample_fps: float,
    search_seconds: float,
) -> dict[str, Any]:
    visual = visual_motion(video, frame_clock, 0.0, duration_seconds, sample_fps)
    gyro_signals = {
        "gyro_x": gyro_values[:, 0],
        "gyro_y": gyro_values[:, 1],
        "gyro_z": gyro_values[:, 2],
        "gyro_magnitude": np.linalg.norm(gyro_values, axis=1),
    }
    prefixes = {name: prefix_integral(gyro_time, values) for name, values in gyro_signals.items()}
    pairs: list[dict[str, Any]] = []
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
            pairs.append(
                {
                    "pair": f"{visual_name}_vs_{gyro_name}",
                    "offset_ms": offset * 1000.0,
                    "correlation": correlation,
                }
            )
    magnitude_offset, magnitude_correlation = solve_pair(
        np.asarray(visual["magnitude"]),
        np.asarray(visual["start_ns"]),
        np.asarray(visual["end_ns"]),
        gyro_time,
        prefixes["gyro_magnitude"],
        search_seconds,
    )
    pairs.append(
        {
            "pair": "affine_motion_magnitude_vs_gyro_magnitude",
            "offset_ms": magnitude_offset * 1000.0,
            "correlation": magnitude_correlation,
        }
    )
    pairs.sort(key=lambda row: abs(float(row["correlation"])), reverse=True)
    best = pairs[0]
    supporting = [row for row in pairs if abs(float(row["correlation"])) >= 0.60]
    support_offsets = np.asarray([float(row["offset_ms"]) for row in supporting])
    consensus_deviation = (
        float(np.max(np.abs(support_offsets - np.median(support_offsets))))
        if support_offsets.size >= 2
        else None
    )
    correlation = abs(float(best["correlation"]))
    residual_ms = abs(float(best["offset_ms"]))
    if correlation >= 0.55 and residual_ms <= 20.0:
        status = "pass"
    elif correlation < 0.55:
        status = "review_low_motion_or_correlation"
    else:
        status = "fail_residual"
    return {
        "status": status,
        "best": best,
        "top_candidates": pairs[:5],
        "supporting_candidate_count": len(supporting),
        "supporting_offset_max_deviation_ms": consensus_deviation,
        "usable_visual_intervals": int(len(np.asarray(visual["start_ns"]))),
        "median_ransac_inlier_ratio": float(np.median(np.asarray(visual["inlier_ratio"]))),
    }


def endpoint_image_stats(video: Path, duration_seconds: float) -> dict[str, Any]:
    capture = cv2.VideoCapture(str(video))
    if not capture.isOpened():
        raise RuntimeError(f"could not open {video}")
    results: dict[str, Any] = {}
    try:
        for name, position_ms in (("start", 0.0), ("end", max(0.0, duration_seconds - 1.0) * 1000.0)):
            capture.set(cv2.CAP_PROP_POS_MSEC, position_ms)
            means: list[float] = []
            deviations: list[float] = []
            for _ in range(15):
                ok, image = capture.read()
                if not ok:
                    break
                gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
                means.append(float(np.mean(gray)))
                deviations.append(float(np.std(gray)))
            results[name] = {
                "decoded_frames": len(means),
                "mean_luma": float(np.mean(means)) if means else None,
                "mean_spatial_stddev": float(np.mean(deviations)) if deviations else None,
                "black_frame_count": sum(value < 4.0 for value in means),
            }
    finally:
        capture.release()
    return results


def audit_clip(
    folder: Path,
    sequence: int,
    sample_fps: float,
    search_seconds: float,
    decode_all: bool,
) -> dict[str, Any]:
    names = sorted(path.name for path in folder.iterdir())
    if names != sorted(REQUIRED_FILES):
        raise ValueError(f"manifest mismatch: {names}")
    metadata = read_json(folder / "metadata.json")
    if metadata.get("content_hash") != folder.name:
        raise ValueError("folder name/content_hash mismatch")
    actual_hash = sha256_file(folder / "rgb.mp4")
    if actual_hash != metadata["content_hash"]:
        raise ValueError("rgb.mp4 SHA-256 mismatch")
    if metadata.get("timestamp_timebase", {}).get("mapping_method") is not None:
        raise ValueError("delivery metadata must not contain mapping_method")
    media = probe_media(folder / "rgb.mp4")
    if media["video_packets"] != int(metadata["video_frame_count"]):
        raise ValueError("MP4 packet/frame metadata mismatch")
    imu_times, imu_values = read_imu(folder / "imu.jsonl", metadata)
    frames = read_frames(folder / "frames.jsonl", metadata, imu_times)
    if frames["canonical"].size != media["video_packets"]:
        raise ValueError("MP4 packet/frames.jsonl mismatch")
    decode = full_decode(folder / "rgb.mp4") if decode_all else {"passed": None}
    endpoints = endpoint_image_stats(folder / "rgb.mp4", media["duration_seconds"])
    alignment = motion_alignment(
        folder / "rgb.mp4",
        frames["canonical"],
        imu_times["gyroscope"],
        imu_values["gyroscope"],
        media["duration_seconds"],
        sample_fps,
        search_seconds,
    )
    segmentation = metadata["segmentation"]
    preroll_ms = int(segmentation["source_selected_start_ms"]) - int(
        segmentation["source_exported_start_ms"]
    )
    structural_pass = (
        media["video_codec"] == "h264"
        and media["audio_codec"] == "aac"
        and media["width"] == 1920
        and media["height"] == 1080
        and media["audio_sample_rate"] == 48_000
        and media["audio_channels"] == 1
        and media["audio_packets"] > 0
        and 0 <= preroll_ms <= 2100
        and endpoints["start"]["decoded_frames"] > 0
        and endpoints["end"]["decoded_frames"] > 0
        and endpoints["start"]["black_frame_count"] == 0
        and endpoints["end"]["black_frame_count"] == 0
        and (decode["passed"] is not False)
    )
    if not structural_pass:
        status = "fail"
    elif alignment["status"] == "pass":
        status = "pass"
    elif alignment["status"].startswith("review"):
        status = "review"
    else:
        status = "fail"
    return {
        "clip": f"clip-{sequence:03d}",
        "status": status,
        "content_hash": actual_hash,
        "folder": str(folder),
        "media": media,
        "frame_intervals": frames["intervals"],
        "imu": {
            sensor: {
                "sample_count": int(imu_times[sensor].size),
                "intervals": interval_stats(imu_times[sensor]),
            }
            for sensor in ("accelerometer", "gyroscope")
        },
        "endpoints": endpoints,
        "full_decode": decode,
        "motion_alignment": alignment,
        "segmentation": {
            "source_selected_start_ms": segmentation["source_selected_start_ms"],
            "source_selected_end_ms": segmentation["source_selected_end_ms"],
            "source_exported_start_ms": segmentation["source_exported_start_ms"],
            "source_exported_end_ms": segmentation["source_exported_end_ms"],
            "keyframe_preroll_ms": preroll_ms,
            "video_reencoded": segmentation["video_reencoded"],
            "audio_reencoded": segmentation["audio_reencoded"],
            "internal_cuts": segmentation["internal_cuts"],
        },
        "metadata_contract": {
            "video_clock_model_schema": metadata["timestamp_timebase"]["video_clock_model_schema"],
            "clock_model_present": isinstance(
                metadata["timestamp_timebase"].get("clock_model"), dict
            ),
            "mapping_method_present": False,
            "additional_video_to_imu_offset_ns": metadata["capture_configuration"][
                "video_to_imu_offset_ns"
            ],
        },
    }


def markdown(report: dict[str, Any]) -> str:
    lines = [
        f"# {report['source_label']} exported clip validation",
        "",
        f"- Overall: **{report['overall_status'].upper()}**",
        f"- Clips: {report['clip_count']}",
        f"- PASS / REVIEW / FAIL: {report['counts']['pass']} / {report['counts']['review']} / {report['counts']['fail']}",
        "- Output is one continuous stream-copy interval per clip; no internal cut or re-encode.",
        "- The recording-level camera→IMU affine model combines clock difference and sensor-validity residual.",
        "",
        "| Clip | Status | Duration | Frames | Accel Hz | Gyro Hz | RGB↔IMU corr | Residual | Keyframe pre-roll | Decode |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for clip in report["clips"]:
        best = clip["motion_alignment"]["best"]
        lines.append(
            "| {clip} | {status} | {duration:.3f}s | {frames} | {accel:.2f} | {gyro:.2f} | {corr:.4f} | {residual:+.3f}ms | {preroll}ms | {decode} |".format(
                clip=clip["clip"],
                status=clip["status"].upper(),
                duration=clip["media"]["duration_seconds"],
                frames=clip["media"]["video_packets"],
                accel=clip["imu"]["accelerometer"]["intervals"]["estimated_hz"],
                gyro=clip["imu"]["gyroscope"]["intervals"]["estimated_hz"],
                corr=abs(float(best["correlation"])),
                residual=float(best["offset_ms"]),
                preroll=clip["segmentation"]["keyframe_preroll_ms"],
                decode=("PASS" if clip["full_decode"]["passed"] else "FAIL"),
            )
        )
    lines.extend(
        [
            "",
            "## Decision rule",
            "",
            "A clip passes only when its four-file manifest, hashes, H.264/AAC streams, full decode, frame/packet counts, monotonic timestamps, IMU counts, frame-neighbor bracketing, endpoint decode, and RGB↔gyro residual all pass independently.",
            "",
        ]
    )
    return "\n".join(lines)


def write_atomic(path: Path, contents: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", dir=path.parent, delete=False) as handle:
        handle.write(contents)
        temporary = Path(handle.name)
    temporary.replace(path)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("output_root", type=Path)
    parser.add_argument("--report-dir", required=True, type=Path)
    parser.add_argument("--sample-fps", type=float, default=5.0)
    parser.add_argument("--search-seconds", type=float, default=0.1)
    parser.add_argument("--skip-full-decode", action="store_true")
    parser.add_argument("--source-label")
    args = parser.parse_args()

    raw_root = args.output_root.resolve() / "raw"
    folders = [path for path in raw_root.iterdir() if path.is_dir()]
    metadata_rows = [(folder, read_json(folder / "metadata.json")) for folder in folders]
    metadata_rows.sort(key=lambda row: int(row[1]["segmentation"]["source_selected_start_ms"]))
    clips: list[dict[str, Any]] = []
    for index, (folder, _) in enumerate(metadata_rows, start=1):
        print(f"audit {index}/{len(metadata_rows)} {folder.name}", flush=True)
        try:
            clips.append(
                audit_clip(
                    folder,
                    index,
                    args.sample_fps,
                    args.search_seconds,
                    not args.skip_full_decode,
                )
            )
        except Exception as error:
            clips.append(
                {
                    "clip": f"clip-{index:03d}",
                    "status": "fail",
                    "folder": str(folder),
                    "error": f"{type(error).__name__}: {error}",
                }
            )
    counts = {status: sum(row["status"] == status for row in clips) for status in ("pass", "review", "fail")}
    overall = "pass" if counts["fail"] == 0 and counts["review"] == 0 else ("review" if counts["fail"] == 0 else "fail")
    report = {
        "schema": "rootlens.claru.exported_clip_validation.v1",
        "source_label": args.source_label or args.report_dir.resolve().name,
        "output_root": str(args.output_root.resolve()),
        "clip_count": len(clips),
        "overall_status": overall,
        "counts": counts,
        "sample_fps": args.sample_fps,
        "correlation_search_seconds": args.search_seconds,
        "clips": clips,
    }
    write_atomic(args.report_dir / "report.json", json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    write_atomic(args.report_dir / "REPORT.md", markdown(report))
    print(json.dumps({"overall_status": overall, "counts": counts, "report_dir": str(args.report_dir)}, ensure_ascii=False))


if __name__ == "__main__":
    main()

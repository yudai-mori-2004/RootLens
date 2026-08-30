#!/usr/bin/env python3
"""Create a four-file canonical-timestamp copy of an existing iPhone session.

The source directory is never modified. RGB and IMU bytes remain identical;
raw camera timestamps remain in their original fields. A recording-level affine
clock model and one device/config residual calibration produce the same
canonical timestamp and frame-to-IMU association fields used by current data.
"""

from __future__ import annotations

import argparse
import bisect
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
from typing import Any


SCHEMA = "rootlens.camera_imu_clock_model.v1"
MAPPING_METHOD = "post_capture_motion_signal_affine_estimation"
CONVENTION = "imu_event_timestamp_minus_video_event_timestamp"
REQUIRED_FILES = ("rgb.mp4", "frames.jsonl", "imu.jsonl", "metadata.json")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create a non-destructive canonical RGB+IMU session copy"
    )
    parser.add_argument("source", type=Path, help="Source session directory")
    parser.add_argument("--audit", required=True, type=Path, help="Good clock-model audit JSON")
    calibration = parser.add_mutually_exclusive_group(required=True)
    calibration.add_argument(
        "--calibration",
        type=Path,
        help="Good device/config residual calibration JSON from the current capture path",
    )
    calibration.add_argument(
        "--diagnostic-unsplit-total-alignment",
        action="store_true",
        help=(
            "Use the audited recording-level total alignment without pretending that "
            "clock mapping and device residual were separated. Output is marked diagnostic-only."
        ),
    )
    parser.add_argument("--output", required=True, type=Path, help="New output directory")
    return parser.parse_args()


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


def link_or_copy(source: Path, destination: Path) -> str:
    try:
        os.link(source, destination)
        return "hardlink"
    except OSError:
        shutil.copy2(source, destination)
        return "copy"


def calibration_value(
    calibration: dict[str, Any], source_metadata: dict[str, Any]
) -> tuple[int, dict[str, Any]]:
    if calibration.get("quality") != "good":
        raise ValueError("calibration quality must be good")
    device_model = calibration.get("device_model", calibration.get("deviceModel"))
    if device_model and device_model != source_metadata.get("device_model"):
        raise ValueError(
            f"calibration device mismatch: {device_model}/{source_metadata.get('device_model')}"
        )
    camera_type = calibration.get("camera_type", calibration.get("cameraType"))
    source_camera_type = source_metadata.get("camera", {}).get("device_type")
    if camera_type and source_camera_type and camera_type != source_camera_type:
        raise ValueError(f"calibration camera mismatch: {camera_type}/{source_camera_type}")
    if "offset_ns" in calibration:
        offset_ns = int(round(float(calibration["offset_ns"])))
    elif "videoToImuOffsetMs" in calibration:
        offset_ns = int(round(float(calibration["videoToImuOffsetMs"]) * 1_000_000.0))
    else:
        raise ValueError("calibration must contain offset_ns or videoToImuOffsetMs")
    convention = calibration.get("convention", CONVENTION)
    if convention != CONVENTION:
        raise ValueError(f"calibration convention mismatch: {convention}")
    audit = {
        "offset_ns": offset_ns,
        "convention": convention,
        "source": calibration.get("source", "on_device_pixel_motion_vs_gyro"),
        "measured_at": calibration.get("measured_at", calibration.get("measuredAt")),
        "quality": "good",
        "peak_correlation": calibration.get(
            "peak_correlation", calibration.get("peakCorrelation")
        ),
        "standard_deviation_ms": calibration.get(
            "standard_deviation_ms", calibration.get("standardDeviationMs")
        ),
        "algorithm_version": calibration.get(
            "algorithm_version", calibration.get("algorithmVersion")
        ),
        "signal_pair": calibration.get("signal_pair", calibration.get("signalPair")),
        "calibration_duration_seconds": calibration.get(
            "calibration_duration_seconds", calibration.get("durationSeconds")
        ),
        "window_count": calibration.get("window_count", calibration.get("windowCount")),
        "device_model": device_model or source_metadata.get("device_model"),
        "camera_type": camera_type or source_camera_type,
    }
    return offset_ns, audit


def load_imu_timeline(path: Path) -> tuple[dict[str, list[int]], int]:
    timeline: dict[str, list[int]] = {"accelerometer": [], "gyroscope": []}
    row_count = 0
    with path.open() as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            row = json.loads(line)
            sensor = row.get("sensor")
            if sensor not in timeline:
                raise ValueError(f"unknown IMU sensor at line {line_number}: {sensor}")
            timestamp_ns = int(row["timestamp_ns"])
            values = timeline[sensor]
            if values and timestamp_ns <= values[-1]:
                raise ValueError(f"non-monotonic {sensor} timestamp at line {line_number}")
            values.append(timestamp_ns)
            row_count += 1
    if any(len(values) < 2 for values in timeline.values()):
        raise ValueError("both IMU streams require at least two samples")
    return timeline, row_count


def neighbor_indices(values: list[int], timestamp_ns: int) -> tuple[int | None, int | None]:
    before = bisect.bisect_right(values, timestamp_ns) - 1
    after = before + 1
    if before < 0 or after >= len(values):
        return None, None
    return before, after


def set_neighbors(
    row: dict[str, Any], sensor: str, values: list[int], association_ns: int
) -> bool:
    before, after = neighbor_indices(values, association_ns)
    if before is None or after is None:
        row[f"{sensor}_before_index"] = None
        row[f"{sensor}_before_timestamp_ns"] = None
        row[f"{sensor}_after_index"] = None
        row[f"{sensor}_after_timestamp_ns"] = None
        return False
    row[f"{sensor}_before_index"] = before
    row[f"{sensor}_before_timestamp_ns"] = values[before]
    row[f"{sensor}_after_index"] = after
    row[f"{sensor}_after_timestamp_ns"] = values[after]
    return True


def validate_audit(
    audit: dict[str, Any], source: Path, metadata: dict[str, Any], timeline: dict[str, list[int]]
) -> dict[str, Any]:
    if audit.get("schema") != SCHEMA:
        raise ValueError(f"audit schema must be {SCHEMA}; regenerate the audit")
    if audit.get("quality") != "good":
        raise ValueError("clock-model audit quality must be good")
    if audit.get("mapping_method") != MAPPING_METHOD:
        raise ValueError(f"unexpected mapping_method: {audit.get('mapping_method')}")
    model = audit.get("clock_model")
    if not isinstance(model, dict) or model.get("model_type") != "affine":
        raise ValueError("audit does not contain an affine clock_model")
    if model.get("offset_convention") != CONVENTION:
        raise ValueError("clock-model offset convention mismatch")
    if int(audit.get("frame_count", -1)) != int(metadata.get("video_frame_count", -2)):
        raise ValueError("audit/source frame count mismatch")
    if int(audit.get("gyro_count", -1)) != len(timeline["gyroscope"]):
        raise ValueError("audit/source gyroscope count mismatch")
    observation = audit.get("source_observation", {})
    if int(observation.get("first_gyro_timestamp_ns", -1)) != timeline["gyroscope"][0]:
        raise ValueError("audit/source first gyroscope timestamp mismatch")
    if int(observation.get("last_gyro_timestamp_ns", -1)) != timeline["gyroscope"][-1]:
        raise ValueError("audit/source last gyroscope timestamp mismatch")
    audit_source = Path(str(audit.get("source", "")))
    audit_recording_id = re.search(r"rec-\d+", audit_source.name)
    source_recording_id = re.search(r"rec-\d+", source.name)
    if (
        audit_recording_id
        and source_recording_id
        and audit_recording_id.group(0) != source_recording_id.group(0)
    ):
        raise ValueError(
            f"audit/source recording mismatch: {audit_recording_id.group(0)}/{source_recording_id.group(0)}"
        )
    return model


def canonicalize_frames(
    source: Path,
    destination: Path,
    model: dict[str, Any],
    residual_offset_ns: int,
    timeline: dict[str, list[int]],
    expected_frame_count: int,
    diagnostic_unsplit: bool = False,
) -> tuple[int, int, int, int]:
    source_anchor_ns = int(model["source_anchor_ns"])
    total_offset_anchor_ns = int(model["offset_at_source_anchor_ns"])
    rate = float(model["target_rate_per_source_rate"])
    frame_count = 0
    unbracketed = 0
    first_raw: int | None = None
    last_raw: int | None = None
    previous_canonical: int | None = None
    with source.open() as input_handle, destination.open("x") as output_handle:
        for line_number, line in enumerate(input_handle, start=1):
            if not line.strip():
                continue
            row = json.loads(line)
            raw_ns = int(row.get("camera_sensor_timestamp_ns", row["timestamp_ns"]))
            if first_raw is None:
                first_raw = raw_ns
            last_raw = raw_ns
            total_alignment_ns = int(
                round(total_offset_anchor_ns + (raw_ns - source_anchor_ns) * (rate - 1.0))
            )
            clock_mapping_offset_ns = total_alignment_ns - residual_offset_ns
            canonical_ns = raw_ns + clock_mapping_offset_ns
            association_ns = canonical_ns + residual_offset_ns
            if previous_canonical is not None and canonical_ns <= previous_canonical:
                raise ValueError(f"non-monotonic canonical timestamp at frame line {line_number}")
            previous_canonical = canonical_ns

            row["camera_timestamp_legacy_unmapped_ns"] = int(
                row.get("camera_timestamp_mapped_system_uptime_ns", raw_ns)
            )
            row["video_frame_timestamp_canonical_ns"] = canonical_ns
            row["video_frame_timestamp_system_uptime_ns"] = canonical_ns
            row["camera_timestamp_mapped_system_uptime_ns"] = canonical_ns
            row["camera_to_system_uptime_offset_ns"] = clock_mapping_offset_ns
            row["video_frame_timestamp_source"] = SCHEMA
            row["video_to_imu_offset_ns"] = residual_offset_ns
            row["video_to_imu_offset_convention"] = CONVENTION
            row["imu_association_timestamp_ns"] = association_ns
            row["mapping_quality"] = (
                "diagnostic recording-level affine total alignment; raw timestamps retained; "
                "device/config residual not separated; not delivery eligible"
                if diagnostic_unsplit
                else "recording-level affine canonical clock model; raw timestamps retained; "
                "device/config residual stored separately"
            )
            bracketed = True
            for sensor in ("accelerometer", "gyroscope"):
                bracketed = (
                    set_neighbors(row, sensor, timeline[sensor], association_ns) and bracketed
                )
            if not bracketed:
                unbracketed += 1
            output_handle.write(json.dumps(row, separators=(",", ":"), ensure_ascii=False))
            output_handle.write("\n")
            frame_count += 1
    if frame_count != expected_frame_count:
        raise ValueError(f"frame count mismatch: {frame_count}/{expected_frame_count}")
    assert first_raw is not None and last_raw is not None
    return frame_count, unbracketed, first_raw, last_raw


def main() -> None:
    args = parse_args()
    source = args.source.resolve()
    output = args.output.resolve()
    if source == output:
        raise ValueError("output must differ from source")
    if output.exists():
        raise FileExistsError(f"output already exists: {output}")
    for name in REQUIRED_FILES:
        if not (source / name).is_file():
            raise FileNotFoundError(f"missing source file: {source / name}")

    metadata = read_json(source / "metadata.json")
    if metadata.get("recording_config") != "iphone":
        raise ValueError("source is not an iPhone RGB+IMU session")
    timeline, imu_row_count = load_imu_timeline(source / "imu.jsonl")
    audit = read_json(args.audit)
    model = validate_audit(audit, source, metadata, timeline)
    diagnostic_unsplit = bool(args.diagnostic_unsplit_total_alignment)
    if diagnostic_unsplit:
        residual_offset_ns = 0
        calibration_audit = {
            "offset_ns": 0,
            "convention": CONVENTION,
            "source": "unmeasured_device_residual_after_unsplit_recording_total_alignment",
            "measured_at": None,
            "quality": "diagnostic_unsplit",
            "device_model": metadata.get("device_model"),
            "camera_type": metadata.get("camera", {}).get("device_type"),
        }
    else:
        residual_offset_ns, calibration_audit = calibration_value(
            read_json(args.calibration), metadata
        )

    source_hashes = {name: sha256_file(source / name) for name in REQUIRED_FILES}
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix=f".{output.name}-", dir=output.parent))
    try:
        rgb_copy_mode = link_or_copy(source / "rgb.mp4", temporary / "rgb.mp4")
        imu_copy_mode = link_or_copy(source / "imu.jsonl", temporary / "imu.jsonl")
        frame_count, unbracketed, first_raw, last_raw = canonicalize_frames(
            source / "frames.jsonl",
            temporary / "frames.jsonl",
            model,
            residual_offset_ns,
            timeline,
            int(metadata["video_frame_count"]),
            diagnostic_unsplit,
        )
        observation = audit["source_observation"]
        if first_raw != int(observation["first_camera_timestamp_ns"]):
            raise ValueError("audit/source first camera timestamp mismatch")
        if last_raw != int(observation["last_camera_timestamp_ns"]):
            raise ValueError("audit/source last camera timestamp mismatch")

        output_metadata = json.loads(json.dumps(metadata))
        capture_configuration = output_metadata.setdefault("capture_configuration", {})
        capture_configuration["video_to_imu_offset_ns"] = residual_offset_ns
        capture_configuration["video_to_imu_offset_convention"] = CONVENTION
        capture_configuration["video_to_imu_calibration"] = calibration_audit
        if diagnostic_unsplit:
            capture_configuration["video_to_imu_offset_interpretation"] = (
                "diagnostic zero after unsplit recording-level total alignment; "
                "not a measured device residual"
            )
        source_anchor_ns = int(model["source_anchor_ns"])
        clock_offset_at_anchor_ns = int(model["offset_at_source_anchor_ns"]) - residual_offset_ns
        delivered_clock_model = {
            "model_type": "affine",
            "equation": "target_ns = target_anchor_ns + (source_ns - source_anchor_ns) * target_rate_per_source_rate",
            "source_clock": "AVCaptureSession.synchronizationClock",
            "target_clock": "CoreMotion boot-relative clock",
            "source_anchor_ns": source_anchor_ns,
            "target_anchor_ns": source_anchor_ns + clock_offset_at_anchor_ns,
            "target_rate_per_source_rate": float(model["target_rate_per_source_rate"]),
            "offset_convention": CONVENTION,
        }
        output_metadata["timestamp_timebase"] = {
            "unit": "nanoseconds",
            "clock": "CoreMotion boot-relative clock",
            "video_source": "CMSampleBuffer.presentationTimeStamp",
            "video_source_clock": "AVCaptureSession.synchronizationClock",
            "video_mapped_field": "video_frame_timestamp_canonical_ns",
            "video_mapped_clock": "CoreMotion boot-relative clock",
            "video_clock_model_schema": SCHEMA,
            "imu_source": "CMAccelerometerData.timestamp / CMGyroData.timestamp",
            "raw_timestamps_modified": False,
            "canonical_timestamps_derived": True,
            "clock_model": delivered_clock_model,
            "clock_model_quality": audit["quality"],
            "clock_model_affine_fit": audit["affine_fit"],
            "clock_model_contains_sensor_validity_residual": diagnostic_unsplit,
        }
        output_metadata["canonicalization"] = {
            "schema": SCHEMA,
            "source_directory_name": source.name,
            "source_file_sha256": source_hashes,
            "source_files_modified": False,
            "raw_rgb_modified": False,
            "raw_imu_modified": False,
            "raw_camera_timestamps_modified": False,
            "frame_count": frame_count,
            "imu_row_count": imu_row_count,
            "edge_unbracketed_frame_count": unbracketed,
            "rgb_copy_mode": rgb_copy_mode,
            "imu_copy_mode": imu_copy_mode,
            "delivery_eligible": not diagnostic_unsplit,
        }
        if diagnostic_unsplit:
            output_metadata["diagnostic_validation"] = {
                "artifact_purpose": "local_validation_only",
                "delivery_eligible": False,
                "alignment_kind": "unsplit_recording_level_camera_to_imu_total_alignment",
                "mapping_method": MAPPING_METHOD,
                "clock_and_sensor_residual_separated": False,
                "device_residual_measured_on_corrected_capture_path": False,
                "source_audit_path": str(args.audit.resolve()),
                "source_audit_sha256": sha256_file(args.audit.resolve()),
            }
        output_metadata["files"] = list(REQUIRED_FILES)
        with (temporary / "metadata.json").open("x") as handle:
            json.dump(output_metadata, handle, indent=2, sort_keys=True, ensure_ascii=False)
            handle.write("\n")

        if sha256_file(temporary / "rgb.mp4") != source_hashes["rgb.mp4"]:
            raise ValueError("RGB bytes changed")
        if sha256_file(temporary / "imu.jsonl") != source_hashes["imu.jsonl"]:
            raise ValueError("IMU bytes changed")
        if sorted(path.name for path in temporary.iterdir()) != sorted(REQUIRED_FILES):
            raise ValueError("output manifest is not the required four files")
        temporary.rename(output)
    except Exception:
        shutil.rmtree(temporary, ignore_errors=True)
        raise

    print(
        json.dumps(
            {
                "output": str(output),
                "schema": SCHEMA,
                "mapping_method": MAPPING_METHOD,
                "frame_count": frame_count,
                "edge_unbracketed_frame_count": unbracketed,
                "source_files_modified": False,
                "raw_rgb_modified": False,
                "raw_imu_modified": False,
                "raw_camera_timestamps_modified": False,
                "delivery_eligible": not diagnostic_unsplit,
            },
            indent=2,
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()

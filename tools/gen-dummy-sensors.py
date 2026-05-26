"""
mock-device CLI + smoke test 用のダミーセンサーファイル生成。

入力 MP4 から duration / width / height / fps を取り、 以下を生成:
  - sensors.jsonl       30fps、 frame_index + ts_ns + tracking_state + camera_transform (= identity)
                         + 21x2 手ランドマーク (= フレーム中央に固定置き、 両手検出済とする)
  - imu_high_rate.jsonl 100Hz、 加速度 = (0, 0, -9.81)、 ジャイロ = (0, 0, 0) (= 静止状態を模擬)
  - camera_intrinsics.json fx = fy = 1500、 cx = w/2、 cy = h/2、 RGB 解像度 = MP4 native

値は「それっぽい固定値」 で、 Pipeline 2 の品質スコアが「全て合格」 になるように調整してある:
  - 手ランドマーク: 中央固定 = hand_landmark_presence_both 1.0
  - frame_index: 連続 = frame_continuity 1.0、 同期率 1.0
  - tracking_state: 全 2 = tracking_quality 1.0
  - 重力: 9.81 ± 0 = imu_gravity_compliance 1.0
  - 手の移動: 0 = hand_movement 0 (= 静止データの限界)

実機データに置き換える時は、 ARKit / Apple Vision からの実値を流す。
"""

import argparse
import json
import math
import subprocess
import sys
from pathlib import Path


def probe_mp4(mp4_path: Path) -> dict:
    """ffprobe で MP4 の duration / width / height / fps を取る。"""
    cmd = [
        "ffprobe", "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height,r_frame_rate,duration,nb_frames",
        "-of", "json",
        str(mp4_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, check=True)
    streams = json.loads(result.stdout)["streams"]
    if not streams:
        sys.exit(f"no video stream in {mp4_path}")
    s = streams[0]
    # r_frame_rate は "30/1" 形式
    num, den = s["r_frame_rate"].split("/")
    fps = float(num) / float(den)
    # duration は秒。 nb_frames が無い場合に備えて fps から計算
    if "duration" in s:
        duration_sec = float(s["duration"])
    elif "nb_frames" in s:
        duration_sec = int(s["nb_frames"]) / fps
    else:
        sys.exit(f"cannot determine duration of {mp4_path}")
    return {
        "width": int(s["width"]),
        "height": int(s["height"]),
        "fps": fps,
        "duration_sec": duration_sec,
        "frame_count": int(s.get("nb_frames", round(duration_sec * fps))),
    }


def gen_sensors_jsonl(
    out_path: Path, frame_count: int, fps: float, width: int, height: int
) -> None:
    """30fps の sensors.jsonl を出力する (= camera_transform identity、 両手 21x2 ランドマーク中央固定)。"""
    # フレーム中央の手ランドマーク (= 21 関節を中央 ± 数 px 範囲に並べる、 検出済として扱われる程度)
    cx, cy = width / 2.0, height / 2.0
    left_lm = [
        {"x": cx - 80 + i * 2, "y": cy - 60 + (i % 5) * 10, "z": 0.0, "confidence": 0.95}
        for i in range(21)
    ]
    right_lm = [
        {"x": cx + 80 + i * 2, "y": cy - 60 + (i % 5) * 10, "z": 0.0, "confidence": 0.95}
        for i in range(21)
    ]

    with out_path.open("w") as f:
        for idx in range(frame_count):
            ts_ns = int((idx / fps) * 1_000_000_000)
            row = {
                "frame_index": idx,
                "timestamp_ns": ts_ns,
                "tracking_state": 2,  # ARKit normal
                "camera_transform": [
                    [1.0, 0.0, 0.0, 0.0],
                    [0.0, 1.0, 0.0, 0.0],
                    [0.0, 0.0, 1.0, 0.0],
                    [0.0, 0.0, 0.0, 1.0],
                ],
                "hand_landmarks": {
                    "left": left_lm,
                    "right": right_lm,
                },
            }
            f.write(json.dumps(row, separators=(",", ":")) + "\n")


def gen_imu_jsonl(out_path: Path, duration_sec: float) -> None:
    """100Hz の imu_high_rate.jsonl を出力する (= 加速度 = 重力のみ、 静止状態を模擬)。"""
    sample_count = int(math.ceil(duration_sec * 100.0))
    with out_path.open("w") as f:
        for i in range(sample_count):
            ts_ns = int((i / 100.0) * 1_000_000_000)
            row = {
                "timestamp_ns": ts_ns,
                "accel": {"x": 0.0, "y": 0.0, "z": -9.81},
                "gyro": {"x": 0.0, "y": 0.0, "z": 0.0},
                "mag": {"x": 0.0, "y": 0.0, "z": 0.0},
                "device_motion": {
                    "attitude": {"qx": 0.0, "qy": 0.0, "qz": 0.0, "qw": 1.0},
                    "user_accel": {"x": 0.0, "y": 0.0, "z": 0.0},
                    "gravity": {"x": 0.0, "y": 0.0, "z": -9.81},
                    "rotation_rate": {"x": 0.0, "y": 0.0, "z": 0.0},
                },
            }
            f.write(json.dumps(row, separators=(",", ":")) + "\n")


def gen_intrinsics_json(out_path: Path, width: int, height: int) -> None:
    """camera_intrinsics.json を出力する (= fx=fy=1500、 cx=w/2、 cy=h/2)。"""
    data = {
        "fx": 1500.0,
        "fy": 1500.0,
        "cx": width / 2.0,
        "cy": height / 2.0,
        "rgb_resolution": [width, height],
        "depth_resolution": None,
        "device_model": "mock-device",
        "ios_version": "mock",
    }
    out_path.write_text(json.dumps(data, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description="MP4 からダミーセンサーファイルを生成する")
    parser.add_argument("--input", type=Path, required=True, help="入力 MP4")
    parser.add_argument("--output-dir", type=Path, required=True, help="出力ディレクトリ")
    args = parser.parse_args()

    if not args.input.exists():
        sys.exit(f"input not found: {args.input}")

    args.output_dir.mkdir(parents=True, exist_ok=True)

    meta = probe_mp4(args.input)
    print(
        f"input: {args.input} ({meta['width']}x{meta['height']}, "
        f"{meta['fps']:.1f}fps, {meta['duration_sec']:.1f}s, {meta['frame_count']} frames)",
        file=sys.stderr,
    )

    sensors_path = args.output_dir / "sensors.jsonl"
    imu_path = args.output_dir / "imu_high_rate.jsonl"
    intrinsics_path = args.output_dir / "camera_intrinsics.json"

    gen_sensors_jsonl(sensors_path, meta["frame_count"], meta["fps"], meta["width"], meta["height"])
    gen_imu_jsonl(imu_path, meta["duration_sec"])
    gen_intrinsics_json(intrinsics_path, meta["width"], meta["height"])

    result = {
        "sensors_jsonl": str(sensors_path.resolve()),
        "imu_high_rate_jsonl": str(imu_path.resolve()),
        "camera_intrinsics_json": str(intrinsics_path.resolve()),
        "frame_count": meta["frame_count"],
        "duration_sec": meta["duration_sec"],
    }
    print(json.dumps(result))


if __name__ == "__main__":
    main()

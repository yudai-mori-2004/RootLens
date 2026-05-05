#!/usr/bin/env python3
"""
Video-IMU consistency verifier (GTSAM ImuFactor).

入力:
  - mp4 video
  - IMU JSON sidecar  schema: {"samples": [{"timestamp_ns": "...", "accel": [x,y,z], "gyro": [x,y,z]}]}

パイプライン:
  1. mp4 から frame 抽出 (timestamp 込み)
  2. KLT optical flow で隣接 frame 間の relative pose を推定 (essential matrix → recoverPose)
  3. GTSAM factor graph 構築:
       - 各 frame 間の visual BetweenFactorPose3 (回転重視, 並進は high-noise)
       - 各 frame 間の preintegrated ImuFactor
  4. LM 最適化 → graph.error() を Mahalanobis 距離相当として返す

出力: JSON ({n_frames, total_error, avg_mahalanobis, ...})

仕様書 §0.1.2 task 03 (document/v0.1.2/tasks/03-video-imu-consistency/README.md)。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Optional

import cv2
import numpy as np
import gtsam
from gtsam import (
    BetweenFactorPose3,
    ImuFactor,
    LevenbergMarquardtOptimizer,
    NonlinearFactorGraph,
    Point3,
    Pose3,
    PreintegratedImuMeasurements,
    PreintegrationParams,
    Rot3,
    Values,
)

# ---------- Inputs ----------

def parse_imu_json(path: Path) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """IMU JSON を timestamp_ns, accel(N,3), gyro(N,3) に展開。"""
    with open(path) as f:
        data = json.load(f)
    samples = data["samples"]
    n = len(samples)
    ts_ns = np.zeros(n, dtype=np.int64)
    accel = np.zeros((n, 3), dtype=np.float64)
    gyro = np.zeros((n, 3), dtype=np.float64)
    for i, s in enumerate(samples):
        ts_ns[i] = int(s["timestamp_ns"])
        accel[i] = s["accel"]
        gyro[i] = s["gyro"]
    return ts_ns, accel, gyro


def extract_frames(path: Path, max_frames: Optional[int]) -> tuple[list[np.ndarray], np.ndarray, float]:
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise IOError(f"cannot open video: {path}")
    fps = float(cap.get(cv2.CAP_PROP_FPS))
    frames: list[np.ndarray] = []
    ts_ms: list[float] = []
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        ts_ms.append(cap.get(cv2.CAP_PROP_POS_MSEC))
        frames.append(frame)
        if max_frames and len(frames) >= max_frames:
            break
    cap.release()
    return frames, np.array(ts_ms, dtype=np.float64), fps


# ---------- Visual front-end (KLT) ----------

def klt_track(prev_gray: np.ndarray, prev_pts: np.ndarray, next_gray: np.ndarray):
    """Lucas-Kanade で prev_pts を next_gray に追跡。inlier だけ返す。"""
    if prev_pts is None or len(prev_pts) == 0:
        return np.empty((0, 2)), np.empty((0, 2))
    next_pts, status, _ = cv2.calcOpticalFlowPyrLK(prev_gray, next_gray, prev_pts, None)
    if status is None:
        return np.empty((0, 2)), np.empty((0, 2))
    status = status.ravel().astype(bool)
    return prev_pts[status].reshape(-1, 2), next_pts[status].reshape(-1, 2)


def estimate_relative_pose(pts0: np.ndarray, pts1: np.ndarray, K: np.ndarray):
    """essential matrix → recoverPose で R, t (unit translation) を返す。"""
    if len(pts0) < 8:
        return None
    E, _ = cv2.findEssentialMat(pts0, pts1, K, method=cv2.RANSAC, prob=0.999, threshold=1.0)
    if E is None:
        return None
    _, R, t, _ = cv2.recoverPose(E, pts0, pts1, K)
    return R, t.flatten()


def run_visual_odometry(frames: list[np.ndarray], K: np.ndarray) -> list[Optional[tuple[np.ndarray, np.ndarray]]]:
    """frame[i] → frame[i+1] の (R, t) を全 i について返す。失敗 frame は None。"""
    feature_params = dict(maxCorners=300, qualityLevel=0.01, minDistance=10)
    poses: list[Optional[tuple[np.ndarray, np.ndarray]]] = [None]   # frame 0 は前 frame なし
    prev_gray: Optional[np.ndarray] = None
    prev_pts: Optional[np.ndarray] = None
    for i, frame in enumerate(frames):
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        if i == 0:
            prev_pts = cv2.goodFeaturesToTrack(gray, **feature_params)
            prev_gray = gray
            continue
        if prev_pts is None or len(prev_pts) < 50:
            prev_pts = cv2.goodFeaturesToTrack(gray, **feature_params)
            prev_gray = gray
            poses.append(None)
            continue
        pts0, pts1 = klt_track(prev_gray, prev_pts, gray)
        pose = estimate_relative_pose(pts0, pts1, K) if len(pts0) >= 8 else None
        poses.append(pose)
        # 次フレームに向けて点を更新 (足りなくなったら再抽出)
        if len(pts1) < 100:
            prev_pts = cv2.goodFeaturesToTrack(gray, **feature_params)
        else:
            prev_pts = pts1.reshape(-1, 1, 2).astype(np.float32)
        prev_gray = gray
    return poses


# ---------- IMU preintegration ----------

def make_preint_params(g: float = 9.81) -> PreintegrationParams:
    """MEMS IMU 想定の標準ノイズ。実機の datasheet で再調整推奨。"""
    params = PreintegrationParams.MakeSharedU(g)
    params.setAccelerometerCovariance(np.eye(3) * 1e-4)
    params.setGyroscopeCovariance(np.eye(3) * 1e-6)
    params.setIntegrationCovariance(np.eye(3) * 1e-8)
    return params


def preintegrate_window(
    accel: np.ndarray, gyro: np.ndarray, ts_ns: np.ndarray,
    t_start_ns: int, t_end_ns: int, params: PreintegrationParams,
) -> Optional[PreintegratedImuMeasurements]:
    """[t_start_ns, t_end_ns) の IMU sample を preintegration."""
    mask = (ts_ns >= t_start_ns) & (ts_ns < t_end_ns)
    indices = np.where(mask)[0]
    if len(indices) < 2:
        return None
    pim = PreintegratedImuMeasurements(params)
    for j in range(len(indices) - 1):
        i0, i1 = indices[j], indices[j + 1]
        dt_s = (ts_ns[i1] - ts_ns[i0]) / 1e9
        if dt_s <= 0 or dt_s > 0.5:
            continue
        pim.integrateMeasurement(accel[i0], gyro[i0], dt_s)
    return pim


# ---------- Factor graph + residual ----------

def compute_residual(
    visual_poses: list[Optional[tuple[np.ndarray, np.ndarray]]],
    imu_pim_list: list[Optional[PreintegratedImuMeasurements]],
) -> dict:
    """frame pair ごとに ImuFactor + visual BetweenFactorPose3 を建て、最適化後の error を返す。"""
    graph = NonlinearFactorGraph()
    init = Values()

    pose0 = Pose3()
    init.insert(gtsam.symbol('x', 0), pose0)
    init.insert(gtsam.symbol('v', 0), Point3(0.0, 0.0, 0.0))
    init.insert(gtsam.symbol('b', 0), gtsam.imuBias.ConstantBias())

    # 視覚は scale unobservable のため translation 部分は high-noise
    visual_noise = gtsam.noiseModel.Diagonal.Sigmas(
        np.array([0.01, 0.01, 0.01, 1.0, 1.0, 1.0])  # rot 1°相当, trans 1m 相当
    )

    n_pairs = 0
    for i in range(min(len(visual_poses), len(imu_pim_list) + 1)):
        vp = visual_poses[i] if i < len(visual_poses) else None
        pim = imu_pim_list[i - 1] if i >= 1 and (i - 1) < len(imu_pim_list) else None
        if i == 0 or vp is None or pim is None:
            continue

        sym_xi = gtsam.symbol('x', n_pairs)
        sym_xj = gtsam.symbol('x', n_pairs + 1)
        sym_vi = gtsam.symbol('v', n_pairs)
        sym_vj = gtsam.symbol('v', n_pairs + 1)
        sym_bi = gtsam.symbol('b', n_pairs)

        R, t = vp
        rel_pose = Pose3(Rot3(R), Point3(*t))

        if not init.exists(sym_xj):
            init.insert(sym_xj, init.atPose3(sym_xi).compose(rel_pose))
            init.insert(sym_vj, Point3(0.0, 0.0, 0.0))
        if not init.exists(sym_bi):
            init.insert(sym_bi, gtsam.imuBias.ConstantBias())

        graph.add(ImuFactor(sym_xi, sym_vi, sym_xj, sym_vj, sym_bi, pim))
        graph.add(BetweenFactorPose3(sym_xi, sym_xj, rel_pose, visual_noise))

        n_pairs += 1

    if n_pairs == 0:
        return {"n_pairs": 0, "total_error": 0.0, "avg_mahalanobis": 0.0}

    optimizer = LevenbergMarquardtOptimizer(graph, init)
    result = optimizer.optimize()
    total_error = float(graph.error(result))
    return {
        "n_pairs": n_pairs,
        "total_error": total_error,
        "avg_mahalanobis": total_error / n_pairs,
    }


# ---------- CLI ----------

def main() -> None:
    p = argparse.ArgumentParser(description="Video-IMU consistency verifier (GTSAM ImuFactor)")
    p.add_argument("--video", required=True, type=Path)
    p.add_argument("--imu", required=True, type=Path)
    p.add_argument("--intrinsics", default="800,0,640,0,800,360,0,0,1",
                   help="9 floats (row-major) for camera K matrix. 720p の MEMS estimate を default に")
    p.add_argument("--max-frames", type=int, default=120)
    p.add_argument("--out", default="-", help="JSON output path, '-' = stdout")
    args = p.parse_args()

    K = np.array(list(map(float, args.intrinsics.split(",")))).reshape(3, 3)

    print(f"[*] Loading IMU: {args.imu}", file=sys.stderr)
    ts_ns, accel, gyro = parse_imu_json(args.imu)
    print(f"    {len(ts_ns)} samples", file=sys.stderr)

    print(f"[*] Extracting frames: {args.video}", file=sys.stderr)
    frames, ts_ms, fps = extract_frames(args.video, max_frames=args.max_frames)
    print(f"    {len(frames)} frames @ {fps:.1f} fps", file=sys.stderr)

    print("[*] Running KLT visual odometry ...", file=sys.stderr)
    visual_poses = run_visual_odometry(frames, K)
    n_valid = sum(1 for v in visual_poses if v is not None)
    print(f"    {n_valid} valid pairs", file=sys.stderr)

    print("[*] Preintegrating IMU between frames ...", file=sys.stderr)
    pim_params = make_preint_params()
    imu_pims: list[Optional[PreintegratedImuMeasurements]] = []
    for i in range(len(frames) - 1):
        t0_ns = int(ts_ms[i] * 1e6)
        t1_ns = int(ts_ms[i + 1] * 1e6)
        imu_pims.append(preintegrate_window(accel, gyro, ts_ns, t0_ns, t1_ns, pim_params))
    n_imu = sum(1 for x in imu_pims if x is not None)
    print(f"    {n_imu} valid IMU windows", file=sys.stderr)

    print("[*] Building factor graph + optimizing ...", file=sys.stderr)
    metrics = compute_residual(visual_poses, imu_pims)

    out = {
        "video": str(args.video),
        "imu": str(args.imu),
        "n_frames": len(frames),
        "n_imu_samples": int(len(ts_ns)),
        "fps": fps,
        **metrics,
    }
    text = json.dumps(out, indent=2, ensure_ascii=False)
    if args.out == "-":
        print(text)
    else:
        Path(args.out).write_text(text)
        print(f"[*] Wrote {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()

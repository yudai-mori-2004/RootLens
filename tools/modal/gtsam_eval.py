"""
rootlens-server Pipeline 2 Video-IMU 整合性検証 (= GTSAM ImuFactor + KLT optical flow) を
Modal の CPU 関数として実装。 仕様: document/v0.1.3/tasks/07-pipeline-2-gtsam/README.md +
DATA_SPECS_JA.md §3.3 / §3.2.4。

目的:
  画面再撮影攻撃 (= ディスプレイに録画映像を再表示して撮り直す) の検出。 C2PA 署名は
  コンテンツ改ざんを検出するが、 「正当な端末でディスプレイを撮影した」 場合は署名上は
  正規撮影として成立してしまうので、 IMU 信号と映像内の運動が物理的に整合しないことで
  この攻撃を検出する。

入力 (= query string):
  content_id: R2 prefix `raw/<content_id>/` 配下のファイル群を読みに行く

R2 fetch:
  raw/<content_id>/rgb.mp4
  raw/<content_id>/imu_high_rate.jsonl   (= 100Hz, {timestamp_ns, accel:{x,y,z}, gyro:{x,y,z}, ...})
  raw/<content_id>/sensors.jsonl         (= 30fps, タイムスタンプ整合の確認用)
  raw/<content_id>/camera_intrinsics.json (= fx, fy, cx, cy)

アルゴリズム:
  1. cv2.goodFeaturesToTrack + cv2.calcOpticalFlowPyrLK で連続フレーム間の特徴追跡
  2. cv2.findEssentialMat + cv2.recoverPose で各フレーム間の relative pose (= R, t) を推定
  3. gtsam.PreintegratedImuMeasurements で frame 間 IMU を積分
  4. NonlinearFactorGraph に Visual BetweenFactorPose3 + ImuFactor を載せて LM 最適化
  5. graph.error() を残差ノルムとして取得し、 consistency_ratio = exp(-residual / threshold)
     で 0..1 に正規化、 score = round(consistency_ratio * 10)

出力 (= JSON):
  {
    "score": 0..10 整数,
    "residualNorm": float,
    "consistencyRatio": float (= 0..1)
  }

エッジケース:
  feature 追跡に失敗 (= 真っ暗 / 真っ白 / blur 過多)、 有効 frame pair が 0 個、 IMU が空、
  cv2 / gtsam の内部例外 ─ いずれも score=0 / residualNorm=inf / consistencyRatio=0 で返す。

冪等性:
  GTSAM 最適化は決定論的。 cv2 内部 RNG は cv2.setRNGSeed(0) で固定する。

参考実装: pipeline/video-imu-consistency/verify.py (= v0.1.2 CLI 版)。 本ファイルは
schema adapter (= 旧 samples list 形式 → 新 imu_high_rate.jsonl 行形式) と R2 download +
HTTP endpoint wrap を追加した Modal 版。
"""

from __future__ import annotations

import json
import math
import os
from typing import Optional

import modal

# ─── Modal Image 定義 ──────────────────────────────────────────────────

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("libgl1", "libglib2.0-0")
    .pip_install(
        # gtsam は PyPI に precompiled wheel あり (= macOS / linux amd64、 Python 3.8〜3.12)
        "gtsam",
        # numpy<2 は gtsam wheel の ABI と整合させるため (= v0.1.2 verify.py と同条件)
        "numpy<2",
        "opencv-python-headless==4.10.0.84",
        "boto3==1.35.50",
        "fastapi[standard]",
    )
)

app = modal.App("rootlens-gtsam-eval", image=image)

# 残差ノルムの正規化閾値 (= consistency_ratio = exp(-residual / threshold))。
# 残差 0 で ratio=1.0 (= 完全整合)、 residual=threshold で ratio≈0.37、 residual=3×threshold で ratio≈0.05。
# 仕様 §3.2.4 は初期値を手動で置き、 運用データ蓄積後に調整する方針。 1.0 は v0.1.2 verify.py の
# total_error 値域 (= 正常撮影で 0.1〜0.5、 画面再撮影で 2.0+) を念頭に置いた初期値。
RESIDUAL_THRESHOLD = 1.0

# 1 リクエストで処理する最大 frame 数。 30 fps × 4 sec = 120 frames で 30 分動画の冒頭から
# 残差が十分に蓄積する量 (= v0.1.2 CLI のデフォルト値と同じ)。 これ以上増やしても残差ノルムは
# 平均化されて結果が変わらず、 計算コストだけ増える。
MAX_FRAMES = 120


# ─── Modal function (HTTP endpoint) ────────────────────────────────────

@app.function(
    cpu=4.0,
    memory=2048,
    timeout=600,
    secrets=[modal.Secret.from_name("r2-creds")],
)
@modal.fastapi_endpoint(method="POST")
def gtsam_eval(content_id: str):
    """
    Pipeline 2 GTSAM 整合性スコア (= 10 点満点) を返す HTTP endpoint。

    Args (query string):
        content_id: R2 prefix `raw/<content_id>/` のキー部分

    Returns:
        {"score": int, "residualNorm": float, "consistencyRatio": float}
    """
    import boto3

    account_id = os.environ["R2_ACCOUNT_ID"]
    bucket_raw = os.environ.get("R2_BUCKET_RAW", "rootlens-raw")

    s3 = boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )

    work_dir = f"/tmp/gtsam_{content_id}"
    os.makedirs(work_dir, exist_ok=True)
    prefix = f"raw/{content_id}"
    rgb_path = f"{work_dir}/rgb.mp4"
    imu_path = f"{work_dir}/imu_high_rate.jsonl"
    intrinsics_path = f"{work_dir}/camera_intrinsics.json"

    # 必須 4 ファイル (= sensors.jsonl は schema 確認のみ、 本関数では使わないので download しない)
    try:
        s3.download_file(bucket_raw, f"{prefix}/rgb.mp4", rgb_path)
        s3.download_file(bucket_raw, f"{prefix}/imu_high_rate.jsonl", imu_path)
        s3.download_file(bucket_raw, f"{prefix}/camera_intrinsics.json", intrinsics_path)
    except Exception:
        # R2 から読めない (= ファイル欠落 / credential ミス等) → score 0 で返す。
        # 例外を上に投げないのは、 Pipeline 2 全体の進行を 1 ファイル欠落で止めないため。
        return _zero_score()

    # アルゴリズム本体は exception safe な _evaluate に委譲。 cv2 / gtsam の内部例外を
    # ここで catch して score=0 にデグレードする。
    try:
        residual_norm, n_pairs = _evaluate(rgb_path, imu_path, intrinsics_path)
    except Exception:
        return _zero_score()

    if not math.isfinite(residual_norm) or n_pairs == 0:
        # feature 追跡完全失敗 (= 真っ暗 / 真っ白 / blur 過多)。 仕様: 例外でなく score=0。
        return _zero_score()

    consistency_ratio = math.exp(-residual_norm / RESIDUAL_THRESHOLD)
    consistency_ratio = max(0.0, min(1.0, consistency_ratio))
    score = round(consistency_ratio * 10.0)

    return {
        "score": int(score),
        "residualNorm": float(residual_norm),
        "consistencyRatio": float(consistency_ratio),
    }


def _zero_score() -> dict:
    """全失敗パスの共通出力 (= 仕様: 例外でなく score=0 を返す)。
    residualNorm は元々 float("inf") にしていたが、 FastAPI の strict JSON encoder で
    "Out of range float values are not JSON compliant" → 500 になり workflow が
    gtsam-eval で永遠に詰まる。 1e30 を sentinel として使い、 「実質無限大の残差」 を表す。
    consistencyRatio = exp(-1e30) → 0.0 で意味も保たれる。"""
    return {"score": 0, "residualNorm": 1e30, "consistencyRatio": 0.0}


# ─── 評価本体 (= cv2 + gtsam) ──────────────────────────────────────────

def _evaluate(rgb_path: str, imu_path: str, intrinsics_path: str) -> tuple[float, int]:
    """
    rgb.mp4 + imu_high_rate.jsonl + camera_intrinsics.json から残差ノルムと有効 frame pair 数を返す。

    Returns:
      (residual_norm, n_pairs)。 n_pairs=0 のときは追跡失敗扱い。
    """
    import cv2
    import numpy as np

    # cv2 内部 RNG を固定 (= goodFeaturesToTrack / findEssentialMat の RANSAC の再現性)。
    cv2.setRNGSeed(0)

    K = _load_intrinsics(intrinsics_path)
    ts_ns, accel, gyro = _load_imu(imu_path)
    frames, ts_ms, _fps = _extract_frames(rgb_path, max_frames=MAX_FRAMES)

    if len(frames) < 2 or len(ts_ns) < 2:
        return float("inf"), 0

    visual_poses = _run_visual_odometry(frames, K)

    imu_pims = []
    pim_params = _make_preint_params()
    for i in range(len(frames) - 1):
        t0_ns = int(ts_ms[i] * 1e6)
        t1_ns = int(ts_ms[i + 1] * 1e6)
        imu_pims.append(_preintegrate_window(accel, gyro, ts_ns, t0_ns, t1_ns, pim_params))

    return _compute_residual(visual_poses, imu_pims)


# ─── Input parsing ─────────────────────────────────────────────────────

def _load_intrinsics(path: str):
    """camera_intrinsics.json から 3x3 K 行列を組み立てる (= fx, fy, cx, cy)。"""
    import numpy as np

    with open(path) as f:
        data = json.load(f)
    fx = float(data.get("fx", 1500.0))
    fy = float(data.get("fy", 1500.0))
    cx = float(data.get("cx", 640.0))
    cy = float(data.get("cy", 360.0))
    return np.array([[fx, 0.0, cx], [0.0, fy, cy], [0.0, 0.0, 1.0]], dtype=np.float64)


def _load_imu(path: str):
    """
    imu_high_rate.jsonl を timestamp_ns, accel(N,3), gyro(N,3) に展開。

    schema (= gen_dummy_sensors.py 準拠、 1 行 1 sample):
      {"timestamp_ns": int,
       "accel": {"x": ..., "y": ..., "z": ...},
       "gyro": {"x": ..., "y": ..., "z": ...},
       ...}

    後方互換: accel / gyro が [x, y, z] 配列の場合もそのまま受ける (= v0.1.2 verify.py の
    旧 JSON sidecar 形式に対応)。
    """
    import numpy as np

    ts_list: list[int] = []
    accel_list: list[list[float]] = []
    gyro_list: list[list[float]] = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            ts_list.append(int(row["timestamp_ns"]))
            accel_list.append(_xyz(row.get("accel")))
            gyro_list.append(_xyz(row.get("gyro")))

    if not ts_list:
        return (
            np.zeros(0, dtype=np.int64),
            np.zeros((0, 3), dtype=np.float64),
            np.zeros((0, 3), dtype=np.float64),
        )
    return (
        np.asarray(ts_list, dtype=np.int64),
        np.asarray(accel_list, dtype=np.float64),
        np.asarray(gyro_list, dtype=np.float64),
    )


def _xyz(v) -> list[float]:
    """{"x":..,"y":..,"z":..} または [x,y,z] のどちらでも [x,y,z] float リストに揃える。
    None / 欠損は [0,0,0]。"""
    if v is None:
        return [0.0, 0.0, 0.0]
    if isinstance(v, dict):
        return [float(v.get("x", 0.0)), float(v.get("y", 0.0)), float(v.get("z", 0.0))]
    if isinstance(v, (list, tuple)) and len(v) >= 3:
        return [float(v[0]), float(v[1]), float(v[2])]
    return [0.0, 0.0, 0.0]


def _extract_frames(path: str, max_frames: int):
    """rgb.mp4 から先頭 max_frames の BGR フレーム + ts_ms (= cv2 が返す ms) + fps を返す。"""
    import cv2
    import numpy as np

    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        return [], np.zeros(0, dtype=np.float64), 30.0
    fps = float(cap.get(cv2.CAP_PROP_FPS)) or 30.0
    frames = []
    ts_ms: list[float] = []
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        ts_ms.append(cap.get(cv2.CAP_PROP_POS_MSEC))
        frames.append(frame)
        if len(frames) >= max_frames:
            break
    cap.release()
    return frames, np.asarray(ts_ms, dtype=np.float64), fps


# ─── Visual odometry (= KLT + Essential matrix) ───────────────────────

def _klt_track(prev_gray, prev_pts, next_gray):
    """Lucas-Kanade で prev_pts を next_gray に追跡、 inlier だけ返す。"""
    import cv2
    import numpy as np

    if prev_pts is None or len(prev_pts) == 0:
        return np.empty((0, 2)), np.empty((0, 2))
    next_pts, status, _err = cv2.calcOpticalFlowPyrLK(prev_gray, next_gray, prev_pts, None)
    if status is None:
        return np.empty((0, 2)), np.empty((0, 2))
    mask = status.ravel().astype(bool)
    return prev_pts[mask].reshape(-1, 2), next_pts[mask].reshape(-1, 2)


def _estimate_relative_pose(pts0, pts1, K):
    """Essential matrix → recoverPose で R, t (= unit translation) を返す。 失敗時 None。"""
    import cv2

    if len(pts0) < 8:
        return None
    E, _mask = cv2.findEssentialMat(pts0, pts1, K, method=cv2.RANSAC, prob=0.999, threshold=1.0)
    if E is None or E.shape != (3, 3):
        return None
    _, R, t, _mask2 = cv2.recoverPose(E, pts0, pts1, K)
    return R, t.flatten()


def _run_visual_odometry(frames, K):
    """frame[i] → frame[i+1] の (R, t) を全 i について返す。 失敗 pair は None。"""
    import cv2
    import numpy as np

    feature_params = dict(maxCorners=300, qualityLevel=0.01, minDistance=10)
    poses: list = [None]  # frame 0 は前 frame なし
    prev_gray = None
    prev_pts = None
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
        pts0, pts1 = _klt_track(prev_gray, prev_pts, gray)
        pose = _estimate_relative_pose(pts0, pts1, K) if len(pts0) >= 8 else None
        poses.append(pose)
        # 次フレーム用に点を更新 (= 足りなければ再抽出)
        if len(pts1) < 100:
            prev_pts = cv2.goodFeaturesToTrack(gray, **feature_params)
        else:
            prev_pts = pts1.reshape(-1, 1, 2).astype(np.float32)
        prev_gray = gray
    return poses


# ─── IMU preintegration ────────────────────────────────────────────────

def _make_preint_params(g: float = 9.81):
    """MEMS IMU 想定の標準ノイズ (= v0.1.2 verify.py と同じ datasheet 推定値)。"""
    import gtsam
    import numpy as np

    params = gtsam.PreintegrationParams.MakeSharedU(g)
    params.setAccelerometerCovariance(np.eye(3) * 1e-4)
    params.setGyroscopeCovariance(np.eye(3) * 1e-6)
    params.setIntegrationCovariance(np.eye(3) * 1e-8)
    return params


def _preintegrate_window(accel, gyro, ts_ns, t_start_ns: int, t_end_ns: int, params):
    """[t_start_ns, t_end_ns) の IMU sample を preintegration。 sample 不足は None を返す。"""
    import gtsam
    import numpy as np

    mask = (ts_ns >= t_start_ns) & (ts_ns < t_end_ns)
    indices = np.where(mask)[0]
    if len(indices) < 2:
        return None
    pim = gtsam.PreintegratedImuMeasurements(params)
    for j in range(len(indices) - 1):
        i0, i1 = indices[j], indices[j + 1]
        dt_s = (ts_ns[i1] - ts_ns[i0]) / 1e9
        # dt_s > 0.5 は IMU rate (= 100Hz) から見て異常値 (= 欠損区間)、 積分から除外。
        if dt_s <= 0 or dt_s > 0.5:
            continue
        pim.integrateMeasurement(accel[i0], gyro[i0], dt_s)
    return pim


# ─── Factor graph + residual ───────────────────────────────────────────

def _compute_residual(visual_poses, imu_pim_list) -> tuple[float, int]:
    """
    frame pair ごとに ImuFactor + visual BetweenFactorPose3 を建て、 最適化後の graph.error() を返す。

    Returns:
      (residual_norm, n_pairs)。 graph.error() は 0.5 × Mahalanobis^2 の和なので、
      sqrt(2 × error) を残差ノルムとして返す (= GTSAM 内部規約)。
    """
    import gtsam
    from gtsam import (
        BetweenFactorPose3,
        ImuFactor,
        LevenbergMarquardtOptimizer,
        NonlinearFactorGraph,
        Point3,
        Pose3,
        Rot3,
        Values,
    )
    import numpy as np

    graph = NonlinearFactorGraph()
    init = Values()

    pose0 = Pose3()
    init.insert(gtsam.symbol("x", 0), pose0)
    init.insert(gtsam.symbol("v", 0), Point3(0.0, 0.0, 0.0))
    init.insert(gtsam.symbol("b", 0), gtsam.imuBias.ConstantBias())

    # 視覚は scale unobservable のため translation 部分は high-noise (= rot 1° / trans 1m 相当)
    visual_noise = gtsam.noiseModel.Diagonal.Sigmas(
        np.array([0.01, 0.01, 0.01, 1.0, 1.0, 1.0])
    )

    n_pairs = 0
    for i in range(min(len(visual_poses), len(imu_pim_list) + 1)):
        vp = visual_poses[i] if i < len(visual_poses) else None
        pim = imu_pim_list[i - 1] if i >= 1 and (i - 1) < len(imu_pim_list) else None
        if i == 0 or vp is None or pim is None:
            continue

        sym_xi = gtsam.symbol("x", n_pairs)
        sym_xj = gtsam.symbol("x", n_pairs + 1)
        sym_vi = gtsam.symbol("v", n_pairs)
        sym_vj = gtsam.symbol("v", n_pairs + 1)
        sym_bi = gtsam.symbol("b", n_pairs)

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
        return float("inf"), 0

    optimizer = LevenbergMarquardtOptimizer(graph, init)
    result = optimizer.optimize()
    total_error = float(graph.error(result))
    # graph.error() = 0.5 × Σ Mahalanobis^2、 平均化して 1 pair あたりに正規化。
    # n_pairs で割って動画長依存を消し、 sqrt で残差ノルム (= 15 次元ベクトルの大きさ相当) に。
    avg_error = total_error / max(n_pairs, 1)
    residual_norm = math.sqrt(max(2.0 * avg_error, 0.0))
    return residual_norm, n_pairs


# ─── ローカル動作確認 ──────────────────────────────────────────────────

@app.local_entrypoint()
def main():
    print("Modal app rootlens-gtsam-eval defined. Deploy with `modal deploy tools/modal/gtsam_eval.py`.")

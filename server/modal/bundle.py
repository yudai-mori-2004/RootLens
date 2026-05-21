"""
rootlens-server サーバパイプライン Pipeline 3 (= 販売データ整形) を Modal の GPU 関数として実装。

入力: 生データ prefix (= rgb.mp4 + sensors.jsonl + imu_high_rate.jsonl + camera_intrinsics.json
      + 任意で depth/*.png) + Pipeline 2 が出した blurred.mp4 + Root NFT asset id
処理:
  1. raw bundle + blurred.mp4 を fetch
  2. WiLoR で全 frame に hand pose 推定 (= MANO pose / shape / 21 keypoint 3D)
  3. sensors.jsonl + imu_high_rate.jsonl + camera intrinsics + hand pose を per-frame に組み立て、
     LeRobot v3 の data/ parquet として書き出し
  4. blurred.mp4 を videos/observation.images.ego_cam/chunk-000/file-000.mp4 に配置
  5. meta/info.json / stats.json / tasks.jsonl / episodes/chunk-000/file-000.parquet を生成
出力: LeRobot v3 dataset prefix (= meta/ data/ videos/ 一式)

詳細は document/v0.1.2/tasks/17-dataset-format/README.md 参照。

実装段階:
  v1 (= 本ファイル): LeRobot v3 ディレクトリレイアウト + RGB MP4 配置 + sensors.jsonl → parquet 展開
                    + WiLoR-mini per-frame inference (= hand keypoints 3D + handedness +
                    MANO pose 48-dim + camera-space wrist 6-DoF action)。
                    MANO shape (betas) は WiLoR-mini が exposed していないため zeros 固定
                    (= MANO 規約で β=0 は neutral hand mean shape を意味する)。
"""

import json
import os
import subprocess
import time

import modal

# ─── Modal Image 定義 ──────────────────────────────────────────────────

image = (
    modal.Image.debian_slim(python_version="3.11")
    # git は WiLoR-mini を git+https で取るのに必要
    .apt_install("ffmpeg", "libgl1", "libglib2.0-0", "git")
    .pip_install(
        # WiLoR-mini が auto-download する MANO + 検出器込み weight に依存。 manual setup 不要。
        # GitHub install (= PyPI 配布なし)。
        "git+https://github.com/warmshao/WiLoR-mini.git",
        "torch==2.4.0",
        "torchvision==0.19.0",
        "ultralytics",
        "pyarrow",
        "numpy<2",
        "opencv-python-headless==4.10.0.84",
        "boto3==1.35.50",
        "fastapi[standard]",
        "datasets",
        "pandas",
    )
)

app = modal.App("rootlens-bundle", image=image)

# ─── WiLoR-mini lazy loader ────────────────────────────────────────────

_wilor_pipeline = None


def get_wilor_pipeline():
    """WiLoR-mini の HandPose3dEstimationPipeline を遅延 init。 初回呼出で HF から weight を
    auto-download (= ~600 MB)、 以降は container 内 cache。"""
    global _wilor_pipeline
    if _wilor_pipeline is None:
        import torch
        from wilor_mini.pipelines.wilor_hand_pose3d_estimation_pipeline import (
            WiLorHandPose3dEstimationPipeline,
        )
        device = "cuda" if torch.cuda.is_available() else "cpu"
        dtype = torch.float16 if device == "cuda" else torch.float32
        _wilor_pipeline = WiLorHandPose3dEstimationPipeline(device=device, dtype=dtype, verbose=False)
    return _wilor_pipeline


def _extract_hand_observations(rgb_bgr) -> dict:
    """1 frame の BGR 画像から WiLoR-mini で hand pose を抽出。 LeRobot v3 schema 用の
    per-frame 値を辞書で返す。

    Returns:
      {
        "keypoints":   [2, 21, 3] (= [left, right] keypoint 3D、 MANO canonical hand-local space)
        "present":     [2] bool   (= [left, right])
        "action":      [14]       (= 両手手首 6-DoF camera-space [xyz + quat] × 2)
        "mano_pose":   [2, 48]    (= global_orient 3 + hand_pose 15×3=45 concat、 axis-angle)
      }

    WiLoR-mini source ([1] 参照) の wilor_preds dict:
      - "pred_keypoints_3d": [1, 21, 3]  canonical space (= hand-local)
      - "global_orient":     [1, 1, 3]   axis-angle、 手の global 回転
      - "hand_pose":         [1, 15, 3]  axis-angle × 15 finger 関節
      - "pred_cam_t_full":   [1, 3]      camera-space wrist 位置
      - "pred_vertices":     [1, 778, 3] mesh (= 本関数では取得せず、 dataset へ含めない)
      - "pred_keypoints_2d": [1, 21, 2]  画像投影
      - "scaled_focal_length": scalar

    MANO shape (betas) は WiLoR-mini が exposed していないので neutral (= zeros) を caller で詰める。
    MANO 規約で β=0 は neutral hand mean shape を意味する (= 「shape 推定していない」 を明示)。

    [1] https://github.com/warmshao/WiLoR-mini/blob/main/wilor_mini/pipelines/wilor_hand_pose3d_estimation_pipeline.py
    """
    import numpy as np

    pipe = get_wilor_pipeline()
    # 失敗は propagate する。 silent zeros で 504/504 frames が "未検出" として通る
    # silent-failure を避けたい (= GPU OOM や input shape ミスをここで検知)。
    # 「detection が無かった」 は outputs == [] で表現され throw されない。
    outputs = pipe.predict(rgb_bgr)

    # 既定値 (= 未検出 frame は zeros)
    zeros_kp = [[0.0, 0.0, 0.0] for _ in range(21)]
    zero_pose48 = [0.0] * 48
    zero_quat = [0.0, 0.0, 0.0, 1.0]
    keypoints = [list(zeros_kp), list(zeros_kp)]
    mano_pose = [list(zero_pose48), list(zero_pose48)]
    present = [False, False]
    wrist_pos = [[0.0, 0.0, 0.0], [0.0, 0.0, 0.0]]
    wrist_quat = [list(zero_quat), list(zero_quat)]

    for out in outputs:
        if not isinstance(out, dict):
            continue
        preds = out.get("wilor_preds", {})
        is_right = bool(out.get("is_right", False))
        idx = 1 if is_right else 0

        # keypoint 3D (= canonical) [1, 21, 3]
        kp_3d = preds.get("pred_keypoints_3d")
        if kp_3d is None:
            continue
        kp_arr = _to_numpy(kp_3d)
        if kp_arr.ndim == 3 and kp_arr.shape[0] == 1:
            kp_arr = kp_arr[0]
        if kp_arr.shape != (21, 3):
            continue
        keypoints[idx] = kp_arr.astype(np.float32).tolist()
        present[idx] = True

        # camera-space wrist 位置 (= pred_cam_t_full)
        ct = preds.get("pred_cam_t_full")
        if ct is not None:
            ct_arr = _to_numpy(ct).reshape(-1)
            if ct_arr.size >= 3:
                wrist_pos[idx] = [float(ct_arr[0]), float(ct_arr[1]), float(ct_arr[2])]

        # MANO pose: global_orient (3) + hand_pose (15 × 3 = 45) → 48-dim axis-angle
        go = preds.get("global_orient")
        hp = preds.get("hand_pose")
        if go is not None and hp is not None:
            go_arr = _to_numpy(go).reshape(-1)
            hp_arr = _to_numpy(hp).reshape(-1)
            if go_arr.size >= 3 and hp_arr.size >= 45:
                pose48 = np.concatenate([go_arr[:3], hp_arr[:45]]).astype(np.float32)
                mano_pose[idx] = pose48.tolist()
                # wrist rotation quaternion = global_orient axis-angle → quat
                wrist_quat[idx] = _axis_angle_to_quat(go_arr[:3].astype(np.float32))

    # action wrist 6-DoF: 位置 (camera-space) + rotation (= global_orient quaternion)、 左右 concat
    action: list[float] = []
    for hand in (0, 1):
        action.extend([float(wrist_pos[hand][0]), float(wrist_pos[hand][1]), float(wrist_pos[hand][2])])
        action.extend([float(wrist_quat[hand][0]), float(wrist_quat[hand][1]), float(wrist_quat[hand][2]), float(wrist_quat[hand][3])])

    return {
        "keypoints": keypoints,
        "present": present,
        "action": action,
        "mano_pose": mano_pose,
    }


def _to_numpy(x):
    """torch.Tensor / numpy / list を numpy array に揃える。"""
    import numpy as np
    if hasattr(x, "detach"):
        return x.detach().cpu().numpy()
    return np.asarray(x)


def _axis_angle_to_quat(axis_angle) -> list[float]:
    """3-dim axis-angle (= rotation vector) を quaternion (qx, qy, qz, qw) に変換。
    angle = ||axis_angle||、 axis = axis_angle / angle。"""
    import numpy as np
    aa = np.asarray(axis_angle, dtype=np.float32).reshape(-1)
    angle = float(np.linalg.norm(aa))
    if angle < 1e-8:
        return [0.0, 0.0, 0.0, 1.0]
    axis = aa / angle
    s = float(np.sin(angle / 2.0))
    return [float(axis[0] * s), float(axis[1] * s), float(axis[2] * s), float(np.cos(angle / 2.0))]


# ─── Modal function (HTTP endpoint) ────────────────────────────────────

@app.function(
    # WiLoR transformer inference 用。 A10G で ~15-20 FPS、 1 分動画 ~5 sec、 1 clip ~$0.02。
    gpu="A10G",
    memory=16384,
    timeout=1800,
    secrets=[modal.Secret.from_name("r2-creds")],
)
@modal.fastapi_endpoint(method="POST")
def bundle_dataset(
    raw_prefix: str,
    blurred_key: str,
    output_prefix: str,
    root_asset_id: str,
    idempotency_key: str,
):
    """
    Pipeline 3 entry point。 純粋関数: 入力 link を受け取り、 出力 link を返す。

    Args (query string):
        raw_prefix:    生データの R2 prefix (= 例: raw/<content_hash>/)
        blurred_key:   ぼかし済 MP4 の R2 オブジェクトキー (= Pipeline 2 出力)
        output_prefix: 出力 dataset の R2 prefix (= 例: datasets/<root_asset_id>/)
        root_asset_id: TP Root NFT asset id (= info.json の rootlens.* に焼く)
        idempotency_key: 冪等性キー (= 同じ key で 2 回目は短絡)
    """
    import boto3

    account_id = os.environ["R2_ACCOUNT_ID"]
    bucket_raw = os.environ.get("R2_BUCKET_RAW", "rootlens-mcap-raw")
    bucket_blurred = os.environ.get("R2_BUCKET_BLURRED", "rootlens-mcap-blurred")
    bucket_datasets = os.environ.get("R2_BUCKET_DATASETS", bucket_blurred)

    s3 = boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )

    # 冪等性チェック: output_prefix 配下に meta/info.json が既に居れば cached 返す。
    # placeholder (totalFrames=0 等) は silent fake になるので、 info.json を読み戻して
    # 実値を返す。 handsDetectedAvg / uploadedFiles は info.json に保存していないので
    # cached 経路では null (= 不明) を返す。
    info_key = f"{output_prefix.rstrip('/')}/meta/info.json"
    try:
        s3.head_object(Bucket=bucket_datasets, Key=info_key)
        info_obj = s3.get_object(Bucket=bucket_datasets, Key=info_key)
        info_doc = json.loads(info_obj["Body"].read().decode())
        return {
            "totalFrames": int(info_doc.get("total_frames", 0)),
            "fps": float(info_doc.get("fps", 0.0)),
            "handsDetectedAvg": None,
            "durationMs": None,
            "uploadedFiles": None,
            "cached": True,
        }
    except s3.exceptions.ClientError:
        pass

    t_start = time.time()
    work_dir = "/tmp/bundle_work"
    if os.path.exists(work_dir):
        subprocess.run(["rm", "-rf", work_dir], check=True)
    os.makedirs(work_dir, exist_ok=True)

    # 1. raw bundle + blurred.mp4 を fetch
    rgb_path = f"{work_dir}/rgb.mp4"
    sensors_path = f"{work_dir}/sensors.jsonl"
    intrinsics_path = f"{work_dir}/camera_intrinsics.json"

    s3.download_file(bucket_blurred, blurred_key, rgb_path)
    sensors_lines = _try_download_jsonl(s3, bucket_raw, f"{raw_prefix.rstrip('/')}/sensors.jsonl", sensors_path)
    intrinsics = _try_download_json(s3, bucket_raw, f"{raw_prefix.rstrip('/')}/camera_intrinsics.json")

    # 2. RGB から fps + frame 数を取得 (= sensors.jsonl と整合確認)
    probe = subprocess.run(
        ["ffprobe", "-v", "error",
         "-select_streams", "v:0",
         "-show_entries", "stream=nb_frames,r_frame_rate",
         "-of", "default=nokey=1:noprint_wrappers=1",
         rgb_path],
        capture_output=True, text=True, check=True,
    )
    lines = probe.stdout.strip().split("\n")
    rate_str = lines[0]
    nb_frames = int(lines[1]) if len(lines) > 1 else len(sensors_lines)
    num, den = rate_str.split("/")
    fps = float(num) / float(den) if float(den) != 0 else 30.0

    # 3. LeRobot v3 ディレクトリレイアウトを構築 (= cv2 frame loop + WiLoR per-frame)
    ds_root = f"{work_dir}/dataset"
    hands_total = _build_lerobot_v3_dataset(
        ds_root=ds_root,
        rgb_mp4=rgb_path,
        sensors_lines=sensors_lines,
        intrinsics=intrinsics,
        fps=fps,
        nb_frames=nb_frames,
        root_asset_id=root_asset_id,
    )

    # 4. R2 に upload (= output_prefix 配下に meta/ data/ videos/ を全部置く)
    upload_count = _upload_tree(s3, bucket_datasets, output_prefix, ds_root)

    hands_avg = float(hands_total) / float(nb_frames) if nb_frames > 0 else 0.0
    return {
        "totalFrames": nb_frames,
        "fps": fps,
        "handsDetectedAvg": hands_avg,
        "durationMs": int((time.time() - t_start) * 1000),
        "uploadedFiles": upload_count,
        "cached": False,
    }


# ─── ヘルパ ─────────────────────────────────────────────────────────

def _try_download_jsonl(s3, bucket: str, key: str, local_path: str) -> list[dict]:
    """sensors.jsonl を fetch + parse。 存在しなければ空 list を返す (= 端末側未対応 case)。"""
    try:
        s3.download_file(bucket, key, local_path)
    except s3.exceptions.ClientError:
        return []
    lines = []
    with open(local_path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            lines.append(json.loads(line))
    return lines


def _try_download_json(s3, bucket: str, key: str) -> dict:
    """camera_intrinsics.json を fetch。 存在しなければデフォルト返す。"""
    try:
        obj = s3.get_object(Bucket=bucket, Key=key)
        return json.loads(obj["Body"].read().decode())
    except s3.exceptions.ClientError:
        return {}


def _build_lerobot_v3_dataset(
    ds_root: str,
    rgb_mp4: str,
    sensors_lines: list[dict],
    intrinsics: dict,
    fps: float,
    nb_frames: int,
    root_asset_id: str,
) -> int:
    """LeRobot v3 (lerobot v0.5.1 互換) ディレクトリレイアウトを書き出す。"""
    import pyarrow as pa
    import pyarrow.parquet as pq
    import shutil

    rgb_meta = intrinsics.get("rgb", {})
    width = int(rgb_meta.get("width", 1280))
    height = int(rgb_meta.get("height", 720))

    # meta/info.json (= task 17 README で定義した完全 schema)
    info = {
        "codebase_version": "v3.0",
        "robot_type": "rootlens-iphone-ego",
        "total_episodes": 1,
        "total_frames": nb_frames,
        "total_tasks": 1,
        "total_videos": 1,
        "total_chunks": 1,
        "chunks_size": 1000,
        "fps": fps,
        "splits": {"train": "0:1"},
        "data_path": "data/chunk-{chunk_index:03d}/file-{file_index:03d}.parquet",
        "video_path": "videos/{video_key}/chunk-{chunk_index:03d}/file-{file_index:03d}.mp4",
        "features": {
            "timestamp": {"dtype": "float32", "shape": [1], "names": None},
            "frame_index": {"dtype": "int64", "shape": [1], "names": None},
            "episode_index": {"dtype": "int64", "shape": [1], "names": None},
            "index": {"dtype": "int64", "shape": [1], "names": None},
            "task_index": {"dtype": "int64", "shape": [1], "names": None},
            "observation.images.ego_cam": {
                "dtype": "video",
                "shape": [3, height, width],
                "names": ["channels", "height", "width"],
                "info": {
                    "video.fps": fps,
                    "video.codec": "h264",
                    "video.pix_fmt": "yuv420p",
                    "video.is_depth_map": False,
                    "has_audio": False,
                },
            },
            "observation.state": {
                "dtype": "float32",
                "shape": [7],
                "names": ["x", "y", "z", "qx", "qy", "qz", "qw"],
            },
            "observation.imu_orientation": {"dtype": "float32", "shape": [4]},
            "observation.imu_angular_velocity": {"dtype": "float32", "shape": [3]},
            "observation.imu_linear_acceleration": {"dtype": "float32", "shape": [3]},
            "observation.tracking_state": {"dtype": "int8", "shape": [1]},
            "observation.hand_pose_mano": {"dtype": "float32", "shape": [2, 48]},
            "observation.hand_shape_mano": {"dtype": "float32", "shape": [2, 10]},
            "observation.hand_keypoints_3d": {"dtype": "float32", "shape": [2, 21, 3]},
            "observation.hand_present": {"dtype": "bool", "shape": [2]},
            "action": {
                "dtype": "float32",
                "shape": [14],
                "names": [
                    "lh_x", "lh_y", "lh_z", "lh_qx", "lh_qy", "lh_qz", "lh_qw",
                    "rh_x", "rh_y", "rh_z", "rh_qx", "rh_qy", "rh_qz", "rh_qw",
                ],
            },
        },
        "rootlens": {
            "root_nft_asset_id": root_asset_id,
            "pipeline_version": "v0.1.2",
            "bundler_version": "v1-wilor-mano",
        },
    }
    os.makedirs(f"{ds_root}/meta", exist_ok=True)
    with open(f"{ds_root}/meta/info.json", "w") as f:
        json.dump(info, f, indent=2)

    # meta/tasks.jsonl + tasks.parquet
    task_text = "household ego-centric capture"
    with open(f"{ds_root}/meta/tasks.jsonl", "w") as f:
        f.write(json.dumps({"task_index": 0, "task": task_text}) + "\n")
    import pandas as pd
    pd.DataFrame({"task": [task_text]}).rename_axis("task_index").to_parquet(
        f"{ds_root}/meta/tasks.parquet",
    )

    # data parquet (= per-frame observation.state + action + index 列)
    frame_indices = list(range(nb_frames))
    timestamps = [i / fps for i in frame_indices]

    # sensors.jsonl から camera pose / IMU / tracking_state を取り出す + cv2 で
    # 各 frame を decode して WiLoR に通す。 hand 列を実値で埋める。
    import cv2 as _cv2
    tracking_state_map = {"normal": 2, "limited": 1, "notAvailable": 0}
    states: list[list[float]] = []
    imu_orientations: list[list[float]] = []
    imu_ang_vels: list[list[float]] = []
    imu_lin_accs: list[list[float]] = []
    tracking_states: list[int] = []
    hand_kp_all: list[list[list[list[float]]]] = []
    hand_present_all: list[list[bool]] = []
    actions: list[list[float]] = []
    mano_pose_all: list[list[list[float]]] = []
    hands_detected_total = 0

    cap = _cv2.VideoCapture(rgb_mp4)
    try:
        for i in range(nb_frames):
            line = sensors_lines[i] if i < len(sensors_lines) else None
            # state (= camera 6-DoF)
            if line:
                t = line.get("camera_transform")
                if t and len(t) == 4 and len(t[0]) == 4:
                    tx, ty, tz = t[0][3], t[1][3], t[2][3]
                    qx, qy, qz, qw = _rot_to_quat(t)
                    states.append([float(tx), float(ty), float(tz), qx, qy, qz, qw])
                else:
                    states.append([0.0] * 7)
            else:
                states.append([0.0] * 7)
            # IMU snapshot
            imu = (line or {}).get("imu") or {}
            ori = imu.get("orientation") or [0.0, 0.0, 0.0, 1.0]
            ang = imu.get("angular_velocity") or [0.0, 0.0, 0.0]
            acc = imu.get("linear_acceleration") or [0.0, 0.0, 0.0]
            imu_orientations.append([float(x) for x in ori[:4]] + [0.0] * max(0, 4 - len(ori)))
            imu_ang_vels.append([float(x) for x in ang[:3]] + [0.0] * max(0, 3 - len(ang)))
            imu_lin_accs.append([float(x) for x in acc[:3]] + [0.0] * max(0, 3 - len(acc)))
            # tracking_state
            ts_state = (line or {}).get("tracking_state", "notAvailable")
            tracking_states.append(tracking_state_map.get(ts_state, 0))

            # WiLoR hand pose
            ok, frame = cap.read()
            if ok:
                hand = _extract_hand_observations(frame)
            else:
                hand = {
                    "keypoints": [[[0.0, 0.0, 0.0] for _ in range(21)], [[0.0, 0.0, 0.0] for _ in range(21)]],
                    "present": [False, False],
                    "action": [0.0] * 14,
                    "mano_pose": [[0.0] * 48, [0.0] * 48],
                }
            hand_kp_all.append(hand["keypoints"])
            hand_present_all.append(hand["present"])
            actions.append(hand["action"])
            mano_pose_all.append(hand["mano_pose"])
            hands_detected_total += int(hand["present"][0]) + int(hand["present"][1])
    finally:
        cap.release()

    # MANO pose は WiLoR-mini の (global_orient 3 + hand_pose 45) を concat した
    # 48-dim axis-angle として mano_pose_all に集めてある。
    # MANO shape (betas) は WiLoR-mini が exposed していないので zeros (= MANO 規約で
    # β=0 は neutral hand mean shape)。
    zero_shape = [[[0.0] * 10, [0.0] * 10] for _ in range(nb_frames)]

    from datasets import Dataset, Features, Value, Sequence, Array2D, Array3D
    hf_features = Features({
        "timestamp": Value("float32"),
        "frame_index": Value("int64"),
        "episode_index": Value("int64"),
        "index": Value("int64"),
        "task_index": Value("int64"),
        "observation.state": Sequence(Value("float32"), length=7),
        "observation.imu_orientation": Sequence(Value("float32"), length=4),
        "observation.imu_angular_velocity": Sequence(Value("float32"), length=3),
        "observation.imu_linear_acceleration": Sequence(Value("float32"), length=3),
        "observation.tracking_state": Value("int8"),
        "observation.hand_pose_mano": Array2D(shape=(2, 48), dtype="float32"),
        "observation.hand_shape_mano": Array2D(shape=(2, 10), dtype="float32"),
        "observation.hand_keypoints_3d": Array3D(shape=(2, 21, 3), dtype="float32"),
        "observation.hand_present": Sequence(Value("bool"), length=2),
        "action": Sequence(Value("float32"), length=14),
    })
    hf_ds = Dataset.from_dict({
        "timestamp": timestamps,
        "frame_index": frame_indices,
        "episode_index": [0] * nb_frames,
        "index": frame_indices,
        "task_index": [0] * nb_frames,
        "observation.state": states,
        "observation.imu_orientation": imu_orientations,
        "observation.imu_angular_velocity": imu_ang_vels,
        "observation.imu_linear_acceleration": imu_lin_accs,
        "observation.tracking_state": tracking_states,
        "observation.hand_pose_mano": mano_pose_all,
        "observation.hand_shape_mano": zero_shape,
        "observation.hand_keypoints_3d": hand_kp_all,
        "observation.hand_present": hand_present_all,
        "action": actions,
    }, features=hf_features)
    os.makedirs(f"{ds_root}/data/chunk-000", exist_ok=True)
    hf_ds.to_parquet(f"{ds_root}/data/chunk-000/file-000.parquet")

    # meta/stats.json
    import numpy as np
    data_dict = pq.read_table(f"{ds_root}/data/chunk-000/file-000.parquet").to_pydict()
    stats_out: dict = {}
    for col in ["observation.state", "observation.imu_orientation",
                "observation.imu_angular_velocity", "observation.imu_linear_acceleration",
                "observation.hand_pose_mano", "observation.hand_shape_mano",
                "observation.hand_keypoints_3d", "observation.hand_present",
                "action"]:
        arr = np.array(data_dict[col], dtype=np.float32)
        stats_out[col] = {
            "min": arr.min(axis=0).tolist(),
            "max": arr.max(axis=0).tolist(),
            "mean": arr.mean(axis=0).tolist(),
            "std": arr.std(axis=0).tolist(),
        }
    for col in ["observation.tracking_state"]:
        arr = np.array(data_dict[col], dtype=np.float64)
        stats_out[col] = {
            "min": arr.min(axis=0).tolist(),
            "max": arr.max(axis=0).tolist(),
            "mean": arr.mean(axis=0).tolist(),
            "std": arr.std(axis=0).tolist(),
        }
    for col in ["timestamp", "frame_index", "episode_index", "index", "task_index"]:
        arr = np.array(data_dict[col], dtype=np.float64)
        stats_out[col] = {
            "min": [float(arr.min())],
            "max": [float(arr.max())],
            "mean": [float(arr.mean())],
            "std": [float(arr.std())],
        }
    with open(f"{ds_root}/meta/stats.json", "w") as f:
        json.dump(stats_out, f, indent=2)

    # meta/episodes/chunk-000/file-000.parquet
    episodes_table = pa.table({
        "episode_index": pa.array([0], type=pa.int64()),
        "tasks": pa.array([[task_text]], type=pa.list_(pa.string())),
        "length": pa.array([nb_frames], type=pa.int64()),
        "data/chunk_index": pa.array([0], type=pa.int64()),
        "data/file_index": pa.array([0], type=pa.int64()),
        "dataset_from_index": pa.array([0], type=pa.int64()),
        "dataset_to_index": pa.array([nb_frames], type=pa.int64()),
        "videos/observation.images.ego_cam/chunk_index": pa.array([0], type=pa.int64()),
        "videos/observation.images.ego_cam/file_index": pa.array([0], type=pa.int64()),
        "videos/observation.images.ego_cam/from_timestamp": pa.array([0.0], type=pa.float32()),
        "videos/observation.images.ego_cam/to_timestamp": pa.array([nb_frames / fps], type=pa.float32()),
    })
    os.makedirs(f"{ds_root}/meta/episodes/chunk-000", exist_ok=True)
    pq.write_table(episodes_table, f"{ds_root}/meta/episodes/chunk-000/file-000.parquet")

    # videos/observation.images.ego_cam/chunk-000/file-000.mp4
    video_dir = f"{ds_root}/videos/observation.images.ego_cam/chunk-000"
    os.makedirs(video_dir, exist_ok=True)
    shutil.copy(rgb_mp4, f"{video_dir}/file-000.mp4")

    return hands_detected_total


def _rot_to_quat(transform_4x4: list[list[float]]) -> tuple[float, float, float, float]:
    """4×4 transform の左上 3×3 部分行列 → quaternion (qx, qy, qz, qw)。 scipy 無しの素朴実装。"""
    m = transform_4x4
    m00, m01, m02 = m[0][0], m[0][1], m[0][2]
    m10, m11, m12 = m[1][0], m[1][1], m[1][2]
    m20, m21, m22 = m[2][0], m[2][1], m[2][2]
    tr = m00 + m11 + m22
    if tr > 0:
        s = (tr + 1.0) ** 0.5 * 2.0
        qw = 0.25 * s
        qx = (m21 - m12) / s
        qy = (m02 - m20) / s
        qz = (m10 - m01) / s
    elif (m00 > m11) and (m00 > m22):
        s = ((1.0 + m00 - m11 - m22) ** 0.5) * 2.0
        qw = (m21 - m12) / s
        qx = 0.25 * s
        qy = (m01 + m10) / s
        qz = (m02 + m20) / s
    elif m11 > m22:
        s = ((1.0 + m11 - m00 - m22) ** 0.5) * 2.0
        qw = (m02 - m20) / s
        qx = (m01 + m10) / s
        qy = 0.25 * s
        qz = (m12 + m21) / s
    else:
        s = ((1.0 + m22 - m00 - m11) ** 0.5) * 2.0
        qw = (m10 - m01) / s
        qx = (m02 + m20) / s
        qy = (m12 + m21) / s
        qz = 0.25 * s
    return float(qx), float(qy), float(qz), float(qw)


def _upload_tree(s3, bucket: str, key_prefix: str, local_dir: str) -> int:
    """ローカルディレクトリツリーを丸ごと R2 prefix 配下に upload。 アップロード件数を返す。"""
    count = 0
    prefix = key_prefix.rstrip("/")
    for root, _dirs, files in os.walk(local_dir):
        rel = os.path.relpath(root, local_dir)
        for fname in files:
            local_path = os.path.join(root, fname)
            if rel == ".":
                key = f"{prefix}/{fname}"
            else:
                key = f"{prefix}/{rel}/{fname}"
            content_type = (
                "video/mp4" if fname.endswith(".mp4")
                else "application/json" if fname.endswith(".json")
                else "application/x-jsonlines" if fname.endswith(".jsonl")
                else "application/octet-stream"
            )
            s3.upload_file(local_path, bucket, key, ExtraArgs={"ContentType": content_type})
            count += 1
    return count


# ─── ローカル動作確認 ──────────────────────────────────────────────────

@app.local_entrypoint()
def main():
    print("Modal app rootlens-bundle defined. Deploy with `modal deploy server/modal/bundle.py`.")

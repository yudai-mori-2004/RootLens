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
  v1 (= 本ファイル): LeRobot v3 ディレクトリレイアウトの生成 + RGB MP4 の配置 + sensors.jsonl
                    を parquet column に展開する skeleton。 WiLoR 統合は未着手 (= 後段で追加)。
  v2: WiLoR + MANO で hand pose を埋める
  v3: depth / IMU 高 rate と RGB の frame index 同期、 stats.json 自動生成
"""

import json
import os
import subprocess
import time

import modal

# ─── Modal Image 定義 ──────────────────────────────────────────────────

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "libgl1", "libglib2.0-0")
    .pip_install(
        "lerobot>=0.4.0",        # LeRobotDataset v3 writer
        "pyarrow",               # parquet
        "numpy<2",
        "opencv-python-headless==4.10.0.84",
        "boto3==1.35.50",
        "fastapi[standard]",
    )
)

app = modal.App("rootlens-bundle", image=image)

# ─── Modal function (HTTP endpoint) ────────────────────────────────────

@app.function(
    # WiLoR を入れたら gpu="A10G" に上げる。 v1 (= skeleton) は CPU で十分。
    cpu=4,
    memory=4096,
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

    # 冪等性チェック: output_prefix 配下に meta/info.json が既に居れば cached 返す
    info_key = f"{output_prefix.rstrip('/')}/meta/info.json"
    try:
        s3.head_object(Bucket=bucket_datasets, Key=info_key)
        return {
            "totalFrames": 0,
            "fps": 0.0,
            "handsDetectedAvg": 0.0,
            "durationMs": 0,
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

    # 3. LeRobot v3 ディレクトリレイアウトを構築 (= v1 は最小骨組み)
    ds_root = f"{work_dir}/dataset"
    _build_lerobot_v3_skeleton(
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

    return {
        "totalFrames": nb_frames,
        "fps": fps,
        "handsDetectedAvg": 0.0,  # WiLoR 統合後に埋める
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


def _build_lerobot_v3_skeleton(
    ds_root: str,
    rgb_mp4: str,
    sensors_lines: list[dict],
    intrinsics: dict,
    fps: float,
    nb_frames: int,
    root_asset_id: str,
) -> None:
    """LeRobot v3 ディレクトリレイアウトを書き出す (= v1 skeleton)。

    生成物:
      meta/info.json
      meta/tasks.jsonl
      meta/stats.json (= empty placeholder)
      meta/episodes/chunk-000/file-000.parquet (= 1 episode の length / task / offsets)
      data/chunk-000/file-000.parquet (= per-frame の observation.state + timestamp 等)
      videos/observation.images.ego_cam/chunk-000/file-000.mp4 (= 入力 rgb.mp4 を配置)

    WiLoR 統合後に追加:
      data parquet の observation.hand_pose_mano / hand_shape_mano / hand_keypoints_3d 列
    """
    import pyarrow as pa
    import pyarrow.parquet as pq
    import shutil

    rgb_meta = intrinsics.get("rgb", {})
    width = int(rgb_meta.get("width", 1280))
    height = int(rgb_meta.get("height", 720))

    # meta/info.json
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
        "data_path": "data/chunk-{episode_chunk:03d}/file-{file_index:03d}.parquet",
        "video_path": "videos/{video_key}/chunk-{episode_chunk:03d}/file-{file_index:03d}.mp4",
        "features": {
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
            "bundler_version": "v1-skeleton",
        },
    }
    os.makedirs(f"{ds_root}/meta", exist_ok=True)
    with open(f"{ds_root}/meta/info.json", "w") as f:
        json.dump(info, f, indent=2)

    # meta/tasks.jsonl (= 1 タスク。 v1 は固定文言、 task id は呼出側で渡せるよう後で拡張)
    with open(f"{ds_root}/meta/tasks.jsonl", "w") as f:
        f.write(json.dumps({"task_index": 0, "task": "household ego-centric capture"}) + "\n")

    # meta/stats.json (= 空 placeholder、 v1 では計算しない)
    with open(f"{ds_root}/meta/stats.json", "w") as f:
        json.dump({}, f)

    # data parquet (= per-frame observation.state + action + index 列)
    frame_indices = list(range(nb_frames))
    timestamps = [i / fps for i in frame_indices]

    # sensors.jsonl から camera pose を取り出す (= 行不足は zeros で埋める)
    states = []
    for i in range(nb_frames):
        if i < len(sensors_lines):
            t = sensors_lines[i].get("camera_transform")
            if t and len(t) == 4 and len(t[0]) == 4:
                # translation + rotation matrix → quaternion (= scipy 無しの 4-element 近似)
                tx, ty, tz = t[0][3], t[1][3], t[2][3]
                qx, qy, qz, qw = _rot_to_quat(t)
                states.append([float(tx), float(ty), float(tz), qx, qy, qz, qw])
                continue
        states.append([0.0] * 7)

    # action (= 両手手首 6-DoF) は WiLoR 統合まで zeros
    actions = [[0.0] * 14 for _ in range(nb_frames)]

    data_table = pa.table({
        "timestamp": pa.array(timestamps, type=pa.float32()),
        "frame_index": pa.array(frame_indices, type=pa.int64()),
        "episode_index": pa.array([0] * nb_frames, type=pa.int64()),
        "index": pa.array(frame_indices, type=pa.int64()),
        "task_index": pa.array([0] * nb_frames, type=pa.int64()),
        "observation.state": pa.array(states, type=pa.list_(pa.float32(), 7)),
        "action": pa.array(actions, type=pa.list_(pa.float32(), 14)),
    })
    os.makedirs(f"{ds_root}/data/chunk-000", exist_ok=True)
    pq.write_table(data_table, f"{ds_root}/data/chunk-000/file-000.parquet")

    # meta/episodes/chunk-000/file-000.parquet (= 1 行: episode の length / task / offsets)
    episodes_table = pa.table({
        "episode_index": pa.array([0], type=pa.int64()),
        "tasks": pa.array([["household ego-centric capture"]], type=pa.list_(pa.string())),
        "length": pa.array([nb_frames], type=pa.int64()),
        "data/chunk_index": pa.array([0], type=pa.int64()),
        "data/file_index": pa.array([0], type=pa.int64()),
        "dataset_from_index": pa.array([0], type=pa.int64()),
        "dataset_to_index": pa.array([nb_frames], type=pa.int64()),
    })
    os.makedirs(f"{ds_root}/meta/episodes/chunk-000", exist_ok=True)
    pq.write_table(episodes_table, f"{ds_root}/meta/episodes/chunk-000/file-000.parquet")

    # videos/observation.images.ego_cam/chunk-000/file-000.mp4
    video_dir = f"{ds_root}/videos/observation.images.ego_cam/chunk-000"
    os.makedirs(video_dir, exist_ok=True)
    shutil.copy(rgb_mp4, f"{video_dir}/file-000.mp4")


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

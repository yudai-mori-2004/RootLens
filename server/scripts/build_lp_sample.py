"""
RootLens LP 第一弾サンプル dataset 構築 orchestrator (ローカル実行)。

入力:
  - web/public/lp/sample/sample_XXXX.mp4 (= 48 本前後)
  - web/public/lp/sample/json/rootlens_sample_videos.json (= task / region 等のメタ)

処理:
  1. 各 .mp4 を R2_BUCKET_RAW にアップロード (key: lp-sample/<video_id>/rgb.mp4)
  2. Modal の rootlens-lp-bundle / process_lp_clip_r2 を呼ぶ
     → ぼかし + C2PA 「署名 S」 + WiLoR 手検出 が走る
     → ぼかし済 MP4 が R2_BUCKET_BLURRED の key (= lp-sample/<video_id>/blurred.mp4) に出る
     → 戻り値で per-frame の手データが返ってくる
  3. R2_BUCKET_BLURRED からぼかし済 MP4 をローカルに DL
  4. 48 episode の LeRobot v3 dataset を構築:
     - data/chunk-XXX/file-XXX.parquet (= per-frame 手データ + action + index 列)
     - videos/observation.images.ego_cam/chunk-XXX/file-XXX.mp4
     - meta/info.json, meta/tasks.jsonl, meta/episodes/..., meta/stats.json
  5. ローカル `web/public/lp/sample/dataset/` 配下に出力 (= HuggingFace push は別スクリプト)

LP 用 dataset の特性 (= アプリ撮影と異なる):
  - sensors.jsonl / IMU / camera_intrinsics / depth がない
  - 観測列は手関連 (= keypoints / present / pose / shape) + action のみ
  - observation.state, observation.imu_*, observation.tracking_state は parquet 列から除外

実行:
  # 1 本だけ動作確認
  python server/scripts/build_lp_sample.py --only sample_0001

  # 全件
  python server/scripts/build_lp_sample.py
"""

import argparse
import json
import os
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import boto3
import modal
import pyarrow as pa
import pyarrow.parquet as pq
from dotenv import load_dotenv

# ─── パス定数 ──────────────────────────────────────────────────────────

REPO_ROOT = Path(__file__).resolve().parents[2]
SAMPLE_DIR = REPO_ROOT / "web" / "public" / "lp" / "sample"
META_JSON_PATH = SAMPLE_DIR / "json" / "rootlens_sample_videos.json"
OUTPUT_DIR = SAMPLE_DIR / "dataset"

R2_PREFIX = "lp-sample"  # R2 上のキープレフィックス (= raw / blurred 両バケットで共通)

DATASET_CHUNKS_SIZE = 1000  # LeRobot v3 仕様の chunks_size。 1 chunk = 1 episode (= LP は 48 episode で十分小さい)


# ─── 環境変数ロード ────────────────────────────────────────────────────

def load_env() -> None:
    """server/.env と server/.env.local を読み込む (= R2 credential など)。"""
    server_dir = REPO_ROOT / "server"
    for name in (".env", ".env.local"):
        load_dotenv(server_dir / name, override=False)
    required = [
        "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY",
        "R2_BUCKET_RAW", "R2_BUCKET_BLURRED",
    ]
    missing = [k for k in required if not os.environ.get(k)]
    if missing:
        sys.exit(f"missing env vars: {missing}. server/.env(.local) を確認してください。")


# ─── R2 ────────────────────────────────────────────────────────────────

def r2_client():
    return boto3.client(
        "s3",
        endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )


def r2_upload(s3, bucket: str, key: str, local_path: Path, content_type: str) -> None:
    s3.upload_file(str(local_path), bucket, key, ExtraArgs={"ContentType": content_type})


def r2_download(s3, bucket: str, key: str, local_path: Path) -> None:
    local_path.parent.mkdir(parents=True, exist_ok=True)
    s3.download_file(bucket, key, str(local_path))


def r2_head_exists(s3, bucket: str, key: str) -> bool:
    try:
        s3.head_object(Bucket=bucket, Key=key)
        return True
    except s3.exceptions.ClientError:
        return False


# ─── Modal 関数 lookup ─────────────────────────────────────────────────

def modal_fn():
    """deploy 済の rootlens-lp-bundle / process_lp_clip_r2 を取得。"""
    return modal.Function.from_name("rootlens-lp-bundle", "process_lp_clip_r2")


# ─── per-clip 処理 ─────────────────────────────────────────────────────

def process_one_clip(
    video_meta: dict,
    s3,
    fn,
    skip_existing: bool,
) -> dict:
    """1 本の .mp4 を R2 → Modal → 結果取得 まで実行する。
    戻り値: {
      "video_id": str,
      "task_name": str,
      "category": str,
      "region": str,
      "duration_sec": int,
      "stats": <Modal 関数の戻り値>,
    }
    """
    video_id = video_meta["video_id"]
    file_name = video_meta["file_name"]
    local_mp4 = SAMPLE_DIR / file_name
    if not local_mp4.exists():
        raise FileNotFoundError(f"local mp4 not found: {local_mp4}")

    raw_key = f"{R2_PREFIX}/{video_id}/rgb.mp4"
    blurred_key = f"{R2_PREFIX}/{video_id}/blurred.mp4"
    bucket_raw = os.environ["R2_BUCKET_RAW"]
    bucket_blurred = os.environ["R2_BUCKET_BLURRED"]

    t0 = time.time()

    # 1. R2 へ raw アップロード (= 既に存在すれば短絡)
    if skip_existing and r2_head_exists(s3, bucket_raw, raw_key):
        print(f"[{video_id}] raw already on R2, skip upload")
    else:
        print(f"[{video_id}] uploading raw mp4 ({local_mp4.stat().st_size / 1e6:.1f} MB) ...")
        r2_upload(s3, bucket_raw, raw_key, local_mp4, "video/mp4")

    # 2. Modal 関数呼び出し
    print(f"[{video_id}] invoking modal (blur + C2PA + WiLoR) ...")
    stats = fn.remote(raw_key, blurred_key)
    elapsed = time.time() - t0
    print(
        f"[{video_id}] done: frames={stats['framesProcessed']} faces={stats['facesBlurred']} "
        f"fps={stats['fps']:.2f} elapsed={elapsed:.1f}s"
    )

    return {
        "video_id": video_id,
        "task_name": video_meta["task_name"],
        "category": video_meta.get("category", ""),
        "region": video_meta.get("region", ""),
        "duration_sec": video_meta.get("duration_sec", 0),
        "blurred_key": blurred_key,
        "stats": stats,
    }


# ─── LeRobot v3 dataset 組み立て ───────────────────────────────────────

def assemble_dataset(processed: list[dict], s3, output_dir: Path) -> None:
    """48 episode 分の結果から LeRobot v3 ディレクトリ構造を組み立てる。
    観測列は手関連 (= keypoints / present / pose / shape) + action のみ。
    sensors / IMU / camera intrinsics / depth は parquet 列から完全に除外。
    """
    bucket_blurred = os.environ["R2_BUCKET_BLURRED"]
    # README.md や LICENSE は手で管理する dataset card なので消さない。
    # build_lp_sample.py が生成する部分 (= meta / data / videos) だけ削除する。
    import shutil
    for sub in ("meta", "data", "videos"):
        p = output_dir / sub
        if p.exists():
            shutil.rmtree(p)
    output_dir.mkdir(parents=True, exist_ok=True)

    # tasks.jsonl は task_name の unique 一覧 (= task_index で参照)
    task_names: list[str] = []
    task_index_for: dict[str, int] = {}
    for p in processed:
        name = p["task_name"]
        if name not in task_index_for:
            task_index_for[name] = len(task_names)
            task_names.append(name)

    # episodes 集計 + 全 episode を 1 つの data parquet + 1 video file へ
    # LeRobot v3 では chunks_size を超えると別 file に分割される。
    # LP は episode 数 48 で十分小さいので 1 chunk (= chunks_size=1000) に収まる。
    chunks_size = DATASET_CHUNKS_SIZE
    chunk_idx = 0
    file_idx = 0

    # videos/observation.images.ego_cam/chunk-000/episode_XXX.mp4 を episode 別に出す
    # (= LeRobot v3 では 1 chunk = N episodes の MP4 を 1 file に concat する形が標準だが、
    #  LP では「個別動画を独立して見せたい」 ため episode = file の構造に倒す。
    #  data parquet の episode_index で対応が取れる)。
    video_subdir = output_dir / "videos" / "observation.images.ego_cam" / f"chunk-{chunk_idx:03d}"
    video_subdir.mkdir(parents=True, exist_ok=True)

    # 全 episode の per-frame 配列
    timestamps_all: list[float] = []
    frame_indices_all: list[int] = []
    episode_indices_all: list[int] = []
    index_all: list[int] = []
    task_indices_all: list[int] = []
    hand_kp_all: list[list[list[list[float]]]] = []
    hand_present_all: list[list[bool]] = []
    actions_all: list[list[float]] = []
    mano_pose_all: list[list[list[float]]] = []

    # episodes metadata
    episode_rows: list[dict] = []
    global_index = 0
    fps_for_info: float | None = None
    width_for_info: int | None = None
    height_for_info: int | None = None

    for ep_idx, p in enumerate(processed):
        stats = p["stats"]
        nb_frames = int(stats["framesProcessed"])
        fps = float(stats["fps"])
        width = int(stats["width"])
        height = int(stats["height"])
        # 代表値 (= 最初の episode の値) を info.json に焼く
        if fps_for_info is None:
            fps_for_info = fps
            width_for_info = width
            height_for_info = height

        hand_records = stats["handRecords"]
        if len(hand_records) != nb_frames:
            print(
                f"warning: {p['video_id']} frames={nb_frames} but handRecords={len(hand_records)}",
                file=sys.stderr,
            )

        # episode 配下の動画を R2 から DL して videos/ 配下に置く
        target_video_path = video_subdir / f"episode_{ep_idx:03d}.mp4"
        r2_download(s3, bucket_blurred, p["blurred_key"], target_video_path)

        # per-frame 配列を 1 dataset 全体に積む
        for fi in range(nb_frames):
            rec = hand_records[fi] if fi < len(hand_records) else None
            if rec is None:
                # 起こり得ないが念のため (= silent zeros を避けるため stats との不整合を表面化)
                raise RuntimeError(
                    f"handRecords missing for {p['video_id']} frame {fi}"
                )
            timestamps_all.append(fi / fps)
            frame_indices_all.append(fi)
            episode_indices_all.append(ep_idx)
            index_all.append(global_index)
            task_indices_all.append(task_index_for[p["task_name"]])
            hand_kp_all.append(rec["keypoints"])
            hand_present_all.append(rec["present"])
            actions_all.append(rec["action"])
            mano_pose_all.append(rec["mano_pose"])
            global_index += 1

        episode_rows.append({
            "episode_index": ep_idx,
            "length": nb_frames,
            "tasks": [p["task_name"]],
            "video_id": p["video_id"],
            "category": p["category"],
            "region": p["region"],
        })

    if fps_for_info is None or width_for_info is None or height_for_info is None:
        raise RuntimeError("no episode processed, cannot build dataset")

    total_frames = global_index
    total_episodes = len(processed)
    total_tasks = len(task_names)

    # MANO shape (betas) は WiLoR-mini が exposed していないので zeros 固定 (= MANO 規約で
    # β=0 は neutral hand mean shape を意味する)。
    zero_shape = [[[0.0] * 10, [0.0] * 10] for _ in range(total_frames)]

    # ─── data parquet を書く ────────────────────────────────────────────
    # video_path テンプレ: videos/{video_key}/chunk-XXX/episode_XXX.mp4
    # data_path テンプレ: data/chunk-XXX/file-XXX.parquet
    data_table = pa.table({
        "timestamp": pa.array(timestamps_all, type=pa.float32()),
        "frame_index": pa.array(frame_indices_all, type=pa.int64()),
        "episode_index": pa.array(episode_indices_all, type=pa.int64()),
        "index": pa.array(index_all, type=pa.int64()),
        "task_index": pa.array(task_indices_all, type=pa.int64()),
        "observation.hand_pose_mano": pa.array(
            mano_pose_all, type=pa.list_(pa.list_(pa.float32(), 48), 2),
        ),
        "observation.hand_shape_mano": pa.array(
            zero_shape, type=pa.list_(pa.list_(pa.float32(), 10), 2),
        ),
        "observation.hand_keypoints_3d": pa.array(
            hand_kp_all, type=pa.list_(pa.list_(pa.list_(pa.float32(), 3), 21), 2),
        ),
        "observation.hand_present": pa.array(hand_present_all, type=pa.list_(pa.bool_(), 2)),
        "action": pa.array(actions_all, type=pa.list_(pa.float32(), 14)),
    })
    (output_dir / "data" / f"chunk-{chunk_idx:03d}").mkdir(parents=True, exist_ok=True)
    pq.write_table(
        data_table,
        output_dir / "data" / f"chunk-{chunk_idx:03d}" / f"file-{file_idx:03d}.parquet",
    )

    # ─── meta/info.json ────────────────────────────────────────────────
    info = {
        "codebase_version": "v3.0",
        "robot_type": "rootlens-iphone-ego",
        "total_episodes": total_episodes,
        "total_frames": total_frames,
        "total_tasks": total_tasks,
        "total_videos": total_episodes,
        "total_chunks": 1,
        "chunks_size": chunks_size,
        "fps": fps_for_info,
        "splits": {"train": f"0:{total_episodes}"},
        "data_path": "data/chunk-{episode_chunk:03d}/file-{file_index:03d}.parquet",
        # episode_XXX.mp4 形式で出すため video_path テンプレを書き換え
        "video_path": "videos/{video_key}/chunk-{episode_chunk:03d}/episode_{episode_index:03d}.mp4",
        "features": {
            "observation.images.ego_cam": {
                "dtype": "video",
                "shape": [3, height_for_info, width_for_info],
                "names": ["channels", "height", "width"],
                "info": {
                    "video.fps": fps_for_info,
                    "video.codec": "h264",
                    "video.pix_fmt": "yuv420p",
                    "video.is_depth_map": False,
                    "has_audio": False,
                },
            },
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
            "release": "lp-sample-v0.1",
            "pipeline_version": "v0.1.2",
            "bundler_version": "v1-wilor-mano",
            "capture_source": "external-iphone-native-camera",
            "notes": (
                "First-person household task clips shot with the stock iPhone Camera app. "
                "Contains video, server-applied face blur, server C2PA signature S, "
                "and per-frame WiLoR-mini hand pose. Does NOT contain IMU, camera 6DoF, "
                "depth, or ARKit tracking state (= those require the RootLens capture app)."
            ),
        },
    }
    (output_dir / "meta").mkdir(parents=True, exist_ok=True)
    with open(output_dir / "meta" / "info.json", "w") as f:
        json.dump(info, f, indent=2)

    # ─── meta/tasks.jsonl ──────────────────────────────────────────────
    with open(output_dir / "meta" / "tasks.jsonl", "w") as f:
        for ti, name in enumerate(task_names):
            f.write(json.dumps({"task_index": ti, "task": name}) + "\n")

    # ─── meta/episodes/chunk-000/file-000.parquet ──────────────────────
    episodes_table = pa.table({
        "episode_index": pa.array([e["episode_index"] for e in episode_rows], type=pa.int64()),
        "length": pa.array([e["length"] for e in episode_rows], type=pa.int64()),
        "tasks": pa.array([e["tasks"] for e in episode_rows], type=pa.list_(pa.string())),
        # 拡張 (= LP 用)。 LeRobot loader は無視する。
        "video_id": pa.array([e["video_id"] for e in episode_rows], type=pa.string()),
        "category": pa.array([e["category"] for e in episode_rows], type=pa.string()),
        "region": pa.array([e["region"] for e in episode_rows], type=pa.string()),
    })
    (output_dir / "meta" / "episodes" / f"chunk-{chunk_idx:03d}").mkdir(parents=True, exist_ok=True)
    pq.write_table(
        episodes_table,
        output_dir / "meta" / "episodes" / f"chunk-{chunk_idx:03d}" / f"file-{file_idx:03d}.parquet",
    )

    # ─── meta/stats.json (= v0 は空、 統計計算は別タスク) ───────────────
    with open(output_dir / "meta" / "stats.json", "w") as f:
        json.dump({}, f)

    print(f"\ndataset assembled at {output_dir}")
    print(f"  total_episodes={total_episodes} total_frames={total_frames} total_tasks={total_tasks}")


# ─── main ──────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--only", type=str, default=None,
        help="単一 video_id だけ処理 (= 動作確認用)",
    )
    parser.add_argument(
        "--concurrency", type=int, default=4,
        help="Modal 関数の並列度 (= 全件モードのみ有効)",
    )
    parser.add_argument(
        "--skip-existing-raw", action="store_true",
        help="R2 raw bucket に既に key があったら upload を skip",
    )
    parser.add_argument(
        "--no-assemble", action="store_true",
        help="dataset の組み立てを skip (= R2 上で blur + WiLoR まで済ませて止める)",
    )
    args = parser.parse_args()

    load_env()
    s3 = r2_client()
    fn = modal_fn()

    with open(META_JSON_PATH) as f:
        meta = json.load(f)
    videos = meta["videos"]

    if args.only:
        videos = [v for v in videos if v["video_id"] == args.only]
        if not videos:
            sys.exit(f"video_id not found: {args.only}")

    print(f"processing {len(videos)} clip(s)")

    processed: list[dict] = []
    if args.only or args.concurrency <= 1:
        # シリアル実行
        for v in videos:
            result = process_one_clip(v, s3, fn, args.skip_existing_raw)
            processed.append(result)
    else:
        # 並列実行 (= スレッドプール経由で Modal 関数を並列 invoke)
        with ThreadPoolExecutor(max_workers=args.concurrency) as ex:
            futures = {
                ex.submit(process_one_clip, v, s3, fn, args.skip_existing_raw): v
                for v in videos
            }
            for fut in as_completed(futures):
                v = futures[fut]
                try:
                    processed.append(fut.result())
                except Exception as e:
                    print(f"[{v['video_id']}] FAILED: {e}", file=sys.stderr)
                    raise

    # episode_index は元 JSON の順序に揃える
    order = {v["video_id"]: i for i, v in enumerate(meta["videos"])}
    processed.sort(key=lambda p: order[p["video_id"]])

    if args.no_assemble:
        print("--no-assemble specified, skipping LeRobot dataset assembly.")
        return

    assemble_dataset(processed, s3, OUTPUT_DIR)


if __name__ == "__main__":
    main()

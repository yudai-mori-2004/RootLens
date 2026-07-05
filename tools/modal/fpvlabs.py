# pipeline-fpvlabs: raw セッション → 顔ぼかし → Stera 互換 raw MCAP (DATA_SPECS 外の受け渡し工程)。
#
# FPV Labs (https://fpvlabs.ai/stera) へのデータ受け渡し用。 rootlens-raw-arkit の
# raw/<signature_hash>/ を読み、 顔ぼかしを適用した上で stera-sdk の MCAPReader が
# そのまま読める ROS2 スキーマの MCAP を組み立て、 rootlens-fpvlabs バケットへ書く。
#
#   入力: raw/<hash>/{rgb.mp4, realtime_handpose.jsonl, imu.jsonl, metadata.json[, depth.tar]}
#   出力: <hash>/session.mcap  (= 決定論的キー。 再実行は同キーへの上書き = 冪等)
#
# トピック構成は stera-sdk の TopicConfig (data/mcap/_reader.py) に一致させる:
#   /camera/rgb/compressed   sensor_msgs/CompressedImage (JPEG、 ぼかし適用済み)
#   /camera/depth            sensor_msgs/Image 16UC1 (mm)      ← depth.tar がある場合のみ
#   /camera/camera_info      sensor_msgs/CameraInfo
#   /camera/depth/camera_info sensor_msgs/CameraInfo           ← 同上
#   /camera/pose             geometry_msgs/PoseStamped (ARKit world、 ARKit-native 軸)
#   /camera/tracking_state   stera_msgs/TrackingState
#   /device/imu              sensor_msgs/Imu (m/s^2、 CoreMotion 軸のまま)
#   /tf                      tf2_msgs/TFMessage (camera_link → camera_optical_frame)
#   /trajectory              nav_msgs/Path
#   /rootlens/processing_info std_msgs/String (JSON: ぼかしモデル・パラメータ・pipeline version)
#
# 冪等性: 出力キーは signature_hash から決定論的。 ローカル一時ファイルに全て書いてから
# 1 回の put_object / multipart で上書きする (= 半端な状態がバケットに残らない)。
# 設定を変えて再実行すれば同キーが新しい内容で置き換わり、 processing_info で判別できる。
#
# 実行:
#   ローカル:  python tools/modal/fpvlabs.py <signature_hash>   (R2 creds は env で)
#   Modal:    modal run tools/modal/fpvlabs.py --signature-hash <hash>
#   deploy:   modal deploy tools/modal/fpvlabs.py

from __future__ import annotations

import io
import json
import os
import tarfile
import tempfile
import time

PIPELINE_VERSION = "fpvlabs-1"

# ─── ROS2 msgdef (= mcap_ros2 に register する連結スキーマ) ────────────

_HEADER_DEP = """================================================================================
MSG: std_msgs/Header
builtin_interfaces/Time stamp
string frame_id
================================================================================
MSG: builtin_interfaces/Time
int32 sec
uint32 nanosec"""

MSGDEFS: dict[str, str] = {
    "sensor_msgs/CompressedImage": f"""std_msgs/Header header
string format
uint8[] data
{_HEADER_DEP}""",
    "sensor_msgs/Image": f"""std_msgs/Header header
uint32 height
uint32 width
string encoding
uint8 is_bigendian
uint32 step
uint8[] data
{_HEADER_DEP}""",
    "sensor_msgs/CameraInfo": f"""std_msgs/Header header
uint32 height
uint32 width
string distortion_model
float64[] d
float64[9] k
float64[9] r
float64[12] p
uint32 binning_x
uint32 binning_y
sensor_msgs/RegionOfInterest roi
{_HEADER_DEP}
================================================================================
MSG: sensor_msgs/RegionOfInterest
uint32 x_offset
uint32 y_offset
uint32 height
uint32 width
bool do_rectify""",
    "geometry_msgs/PoseStamped": f"""std_msgs/Header header
geometry_msgs/Pose pose
{_HEADER_DEP}
================================================================================
MSG: geometry_msgs/Pose
geometry_msgs/Point position
geometry_msgs/Quaternion orientation
================================================================================
MSG: geometry_msgs/Point
float64 x
float64 y
float64 z
================================================================================
MSG: geometry_msgs/Quaternion
float64 x
float64 y
float64 z
float64 w""",
    "sensor_msgs/Imu": f"""std_msgs/Header header
geometry_msgs/Quaternion orientation
float64[9] orientation_covariance
geometry_msgs/Vector3 angular_velocity
float64[9] angular_velocity_covariance
geometry_msgs/Vector3 linear_acceleration
float64[9] linear_acceleration_covariance
{_HEADER_DEP}
================================================================================
MSG: geometry_msgs/Quaternion
float64 x
float64 y
float64 z
float64 w
================================================================================
MSG: geometry_msgs/Vector3
float64 x
float64 y
float64 z""",
    "tf2_msgs/TFMessage": f"""geometry_msgs/TransformStamped[] transforms
================================================================================
MSG: geometry_msgs/TransformStamped
std_msgs/Header header
string child_frame_id
geometry_msgs/Transform transform
{_HEADER_DEP}
================================================================================
MSG: geometry_msgs/Transform
geometry_msgs/Vector3 translation
geometry_msgs/Quaternion rotation
================================================================================
MSG: geometry_msgs/Vector3
float64 x
float64 y
float64 z
================================================================================
MSG: geometry_msgs/Quaternion
float64 x
float64 y
float64 z
float64 w""",
    "nav_msgs/Path": f"""std_msgs/Header header
geometry_msgs/PoseStamped[] poses
{_HEADER_DEP}
================================================================================
MSG: geometry_msgs/PoseStamped
std_msgs/Header header
geometry_msgs/Pose pose
================================================================================
MSG: geometry_msgs/Pose
geometry_msgs/Point position
geometry_msgs/Quaternion orientation
================================================================================
MSG: geometry_msgs/Point
float64 x
float64 y
float64 z
================================================================================
MSG: geometry_msgs/Quaternion
float64 x
float64 y
float64 z
float64 w""",
    "stera_msgs/TrackingState": f"""std_msgs/Header header
int32 state
int32 reason
string state_str
string reason_str
{_HEADER_DEP}""",
    "std_msgs/String": "string data",
    "sensor_msgs/PointCloud2": f"""std_msgs/Header header
uint32 height
uint32 width
sensor_msgs/PointField[] fields
bool is_bigendian
uint32 point_step
uint32 row_step
uint8[] data
bool is_dense
{_HEADER_DEP}
================================================================================
MSG: sensor_msgs/PointField
string name
uint32 offset
uint8 datatype
uint32 count""",
    # 縮約版 Marker (= stera-sdk の decode_mesh_marker が使う points / colors を含む主要 field のみ)
    "visualization_msgs/Marker": f"""std_msgs/Header header
string ns
int32 id
int32 type
int32 action
geometry_msgs/Pose pose
geometry_msgs/Vector3 scale
std_msgs/ColorRGBA color
geometry_msgs/Point[] points
std_msgs/ColorRGBA[] colors
{_HEADER_DEP}
================================================================================
MSG: geometry_msgs/Pose
geometry_msgs/Point position
geometry_msgs/Quaternion orientation
================================================================================
MSG: geometry_msgs/Point
float64 x
float64 y
float64 z
================================================================================
MSG: geometry_msgs/Quaternion
float64 x
float64 y
float64 z
float64 w
================================================================================
MSG: geometry_msgs/Vector3
float64 x
float64 y
float64 z
================================================================================
MSG: std_msgs/ColorRGBA
float32 r
float32 g
float32 b
float32 a""",
}

_XYZ_FIELDS = [
    {"name": "x", "offset": 0, "datatype": 7, "count": 1},
    {"name": "y", "offset": 4, "datatype": 7, "count": 1},
    {"name": "z", "offset": 8, "datatype": 7, "count": 1},
]


def _point_cloud2_msg(ts_ns: int, xyz_f32_bytes: bytes, n: int) -> dict:
    return {
        "header": {"stamp": _stamp(ts_ns), "frame_id": "world"},
        "height": 1,
        "width": n,
        "fields": _XYZ_FIELDS,
        "is_bigendian": False,
        "point_step": 12,
        "row_step": 12 * n,
        "data": xyz_f32_bytes,
        "is_dense": True,
    }

TRACKING_STATE_STR = {0: "notAvailable", 1: "limited", 2: "normal"}
G_TO_MS2 = 9.80665


def _stamp(ts_ns: int) -> dict:
    return {"sec": int(ts_ns // 1_000_000_000), "nanosec": int(ts_ns % 1_000_000_000)}


def _rot_to_quat(r) -> dict:
    """row-major 3x3 → quaternion dict (x,y,z,w)。"""
    import numpy as np

    R = np.asarray(r, dtype=np.float64)
    tr = R[0, 0] + R[1, 1] + R[2, 2]
    if tr > 0:
        s = 0.5 / np.sqrt(tr + 1.0)
        w = 0.25 / s
        x = (R[2, 1] - R[1, 2]) * s
        y = (R[0, 2] - R[2, 0]) * s
        z = (R[1, 0] - R[0, 1]) * s
    elif R[0, 0] > R[1, 1] and R[0, 0] > R[2, 2]:
        s = 2.0 * np.sqrt(1.0 + R[0, 0] - R[1, 1] - R[2, 2])
        w = (R[2, 1] - R[1, 2]) / s
        x = 0.25 * s
        y = (R[0, 1] + R[1, 0]) / s
        z = (R[0, 2] + R[2, 0]) / s
    elif R[1, 1] > R[2, 2]:
        s = 2.0 * np.sqrt(1.0 + R[1, 1] - R[0, 0] - R[2, 2])
        w = (R[0, 2] - R[2, 0]) / s
        x = (R[0, 1] + R[1, 0]) / s
        y = 0.25 * s
        z = (R[1, 2] + R[2, 1]) / s
    else:
        s = 2.0 * np.sqrt(1.0 + R[2, 2] - R[0, 0] - R[1, 1])
        w = (R[1, 0] - R[0, 1]) / s
        x = (R[0, 2] + R[2, 0]) / s
        y = (R[1, 2] + R[2, 1]) / s
        z = 0.25 * s
    return {"x": float(x), "y": float(y), "z": float(z), "w": float(w)}


def _camera_info_msg(ts_ns: int, width: int, height: int, fx: float, fy: float, cx: float, cy: float) -> dict:
    k = [fx, 0.0, cx, 0.0, fy, cy, 0.0, 0.0, 1.0]
    return {
        "header": {"stamp": _stamp(ts_ns), "frame_id": "camera_optical_frame"},
        "height": int(height),
        "width": int(width),
        "distortion_model": "plumb_bob",
        "d": [0.0, 0.0, 0.0, 0.0, 0.0],
        "k": k,
        "r": [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0],
        "p": [fx, 0.0, cx, 0.0, 0.0, fy, cy, 0.0, 0.0, 0.0, 1.0, 0.0],
        "binning_x": 0,
        "binning_y": 0,
        "roi": {"x_offset": 0, "y_offset": 0, "height": 0, "width": 0, "do_rectify": False},
    }


# ─── MCAP 組み立て本体 (= ストリーミング。 フレームをメモリに溜めない) ──


def build_mcap(session_dir: str, out_path: str, blur_model: str = "mediapipe", jpeg_quality: int = 85) -> dict:
    import cv2
    import numpy as np
    from mcap_ros2.writer import Writer as Ros2Writer
    from stera.models import FaceBlurrer

    t0 = time.time()

    meta = json.load(open(os.path.join(session_dir, "metadata.json")))
    cam = meta["camera"]

    # per-frame 行 (= pose / tracking / intrinsics / timestamp)。 1 行 ~1KB なので全読みで問題ない。
    frames_meta: list[dict] = []
    with open(os.path.join(session_dir, "realtime_handpose.jsonl")) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            frames_meta.append(row)
    if not frames_meta:
        raise RuntimeError("realtime_handpose.jsonl is empty")

    blur = FaceBlurrer(model=blur_model)
    blurred_faces_total = 0

    stats = {"rgb": 0, "depth": 0, "pose": 0, "imu": 0, "tracking": 0, "point_cloud": 0, "mesh_anchors": 0}

    with open(out_path, "wb") as out_f:
        writer = Ros2Writer(out_f)
        schemas = {name: writer.register_msgdef(name, text) for name, text in MSGDEFS.items()}

        def write(topic: str, schema_name: str, msg: dict, ts_ns: int) -> None:
            writer.write_message(
                topic=topic, schema=schemas[schema_name], message=msg,
                log_time=ts_ns, publish_time=ts_ns,
            )

        first_ts = int(frames_meta[0]["timestamp_ns"])

        # ── 処理来歴 (= どの設定で作った MCAP か) ──
        write("/rootlens/processing_info", "std_msgs/String", {"data": json.dumps({
            "pipeline_version": PIPELINE_VERSION,
            "blur_model": blur_model,
            "jpeg_quality": jpeg_quality,
            "source": "rootlens raw session",
            "device_model": meta.get("device_model"),
            "app_version": meta.get("app_version"),
            "axes": "ARKit-native (pose: ARKit world; imu: CoreMotion device axes, m/s^2)",
        })}, first_ts)

        # ── /tf: camera_link → camera_optical_frame (= stera-sdk の R_OPTICAL_TO_LINK と整合) ──
        write("/tf", "tf2_msgs/TFMessage", {"transforms": [{
            "header": {"stamp": _stamp(first_ts), "frame_id": "camera_link"},
            "child_frame_id": "camera_optical_frame",
            "transform": {
                "translation": {"x": 0.0, "y": 0.0, "z": 0.0},
                # 180° 回転 (axis = (1,0,1)/√2)。 自身が逆行列なので向きの取り違えが起きない。
                "rotation": {"x": 0.7071067811865476, "y": 0.0, "z": 0.7071067811865476, "w": 0.0},
            },
        }]}, first_ts)

        # ── /camera/camera_info (= 1 回。 SDK は read_first で読む) ──
        write("/camera/camera_info", "sensor_msgs/CameraInfo",
              _camera_info_msg(first_ts, cam["width"], cam["height"], cam["fx"], cam["fy"], cam["cx"], cam["cy"]),
              first_ts)
        if "depth" in cam:
            d = cam["depth"]
            write("/camera/depth/camera_info", "sensor_msgs/CameraInfo",
                  _camera_info_msg(first_ts, d["width"], d["height"], d["fx"], d["fy"], d["cx"], d["cy"]),
                  first_ts)

        # ── /camera/pose + /camera/tracking_state (per-frame) ──
        path_poses = []
        for row in frames_meta:
            ts = int(row["timestamp_ns"])
            t4 = row["camera_transform"]  # row-major 4x4 (ARKit world ← camera)
            pos = {"x": float(t4[0][3]), "y": float(t4[1][3]), "z": float(t4[2][3])}
            quat = _rot_to_quat([r[:3] for r in t4[:3]])
            pose_msg = {
                "header": {"stamp": _stamp(ts), "frame_id": "world"},
                "pose": {"position": pos, "orientation": quat},
            }
            write("/camera/pose", "geometry_msgs/PoseStamped", pose_msg, ts)
            path_poses.append(pose_msg)
            stats["pose"] += 1

            state = int(row.get("tracking_state", 2))
            write("/camera/tracking_state", "stera_msgs/TrackingState", {
                "header": {"stamp": _stamp(ts), "frame_id": "camera_link"},
                "state": state,
                "reason": 0,
                "state_str": TRACKING_STATE_STR.get(state, str(state)),
                "reason_str": str(row.get("tracking_reason", "")),
            }, ts)
            stats["tracking"] += 1

        # ── /trajectory (= 全 pose の Path を 1 回) ──
        write("/trajectory", "nav_msgs/Path", {
            "header": {"stamp": _stamp(first_ts), "frame_id": "world"},
            "poses": path_poses,
        }, int(frames_meta[-1]["timestamp_ns"]))

        # ── /device/imu ──
        imu_path = os.path.join(session_dir, "imu.jsonl")
        if os.path.exists(imu_path):
            with open(imu_path) as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    row = json.loads(line)
                    ts = int(row["timestamp_ns"])
                    acc = row.get("accel", {})
                    gyr = row.get("gyro", {})
                    att = (row.get("device_motion") or {}).get("attitude", {})
                    write("/device/imu", "sensor_msgs/Imu", {
                        "header": {"stamp": _stamp(ts), "frame_id": "imu"},
                        "orientation": {
                            "x": float(att.get("qx", 0.0)), "y": float(att.get("qy", 0.0)),
                            "z": float(att.get("qz", 0.0)), "w": float(att.get("qw", 1.0)),
                        },
                        "orientation_covariance": [0.0] * 9,
                        "angular_velocity": {"x": float(gyr.get("x", 0.0)), "y": float(gyr.get("y", 0.0)), "z": float(gyr.get("z", 0.0))},
                        "angular_velocity_covariance": [0.0] * 9,
                        "linear_acceleration": {
                            "x": float(acc.get("x", 0.0)) * G_TO_MS2,
                            "y": float(acc.get("y", 0.0)) * G_TO_MS2,
                            "z": float(acc.get("z", 0.0)) * G_TO_MS2,
                        },
                        "linear_acceleration_covariance": [0.0] * 9,
                    }, ts)
                    stats["imu"] += 1

        # ── /camera/rgb/compressed (= デコード → ぼかし → JPEG。 1 フレームずつ) ──
        cap = cv2.VideoCapture(os.path.join(session_dir, "rgb.mp4"))
        try:
            i = 0
            while True:
                ok, bgr = cap.read()
                if not ok:
                    break
                # フレーム時刻: jsonl の同 index 行から。 動画の方が長い場合は fps で外挿。
                if i < len(frames_meta):
                    ts = int(frames_meta[i]["timestamp_ns"])
                else:
                    fps = float(cam.get("fps", 30.0)) or 30.0
                    ts = int(frames_meta[-1]["timestamp_ns"]) + int((i - len(frames_meta) + 1) * 1e9 / fps)
                rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
                blurred = blur.blur(rgb)
                if blurred is not rgb:
                    blurred_faces_total += 1  # 近似 (= 検出があったフレーム数ではなく blur 呼出成功数)
                ok_enc, jpg = cv2.imencode(".jpg", cv2.cvtColor(blurred, cv2.COLOR_RGB2BGR),
                                           [int(cv2.IMWRITE_JPEG_QUALITY), jpeg_quality])
                if not ok_enc:
                    raise RuntimeError(f"jpeg encode failed at frame {i}")
                write("/camera/rgb/compressed", "sensor_msgs/CompressedImage", {
                    "header": {"stamp": _stamp(ts), "frame_id": "camera_optical_frame"},
                    "format": "jpeg",
                    "data": jpg.tobytes(),
                }, ts)
                stats["rgb"] += 1
                i += 1
        finally:
            cap.release()

        # ── /camera/depth (= depth.tar がある場合のみ。 16-bit PNG mm → 16UC1) ──
        depth_tar = os.path.join(session_dir, "depth.tar")
        if os.path.exists(depth_tar):
            with tarfile.open(depth_tar) as tar:
                for member in tar:
                    if not member.isfile() or not member.name.endswith(".png"):
                        continue
                    idx = int(os.path.splitext(os.path.basename(member.name))[0])
                    buf = tar.extractfile(member).read()
                    depth = cv2.imdecode(np.frombuffer(buf, np.uint8), cv2.IMREAD_UNCHANGED)
                    if depth is None or depth.dtype != np.uint16:
                        continue
                    ts = int(frames_meta[idx]["timestamp_ns"]) if idx < len(frames_meta) else int(frames_meta[-1]["timestamp_ns"])
                    h, w = depth.shape[:2]
                    write("/camera/depth", "sensor_msgs/Image", {
                        "header": {"stamp": _stamp(ts), "frame_id": "camera_optical_frame"},
                        "height": int(h), "width": int(w),
                        "encoding": "16UC1", "is_bigendian": 0, "step": int(w * 2),
                        "data": np.ascontiguousarray(depth).tobytes(),
                    }, ts)
                    stats["depth"] += 1

        last_ts = int(frames_meta[-1]["timestamp_ns"])

        # ── /map/point_cloud (= VIO 特徴点の全期間 union。 id で去重して最終位置を採用) ──
        pc_path = os.path.join(session_dir, "pointcloud.jsonl")
        if os.path.exists(pc_path):
            import base64

            union = {}
            with open(pc_path) as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    row = json.loads(line)
                    pts = np.frombuffer(base64.b64decode(row["points_b64"]), dtype="<f4").reshape(-1, 3)
                    ids = np.frombuffer(base64.b64decode(row["ids_b64"]), dtype="<u8")
                    for pid, p in zip(ids.tolist(), pts):
                        union[pid] = (float(p[0]), float(p[1]), float(p[2]))
            if union:
                xyz = np.asarray(list(union.values()), dtype="<f4")
                write("/map/point_cloud", "sensor_msgs/PointCloud2",
                      _point_cloud2_msg(last_ts, xyz.tobytes(), len(union)), last_ts)
                stats["point_cloud"] = len(union)

        # ── /map/mesh + /map/mesh_cloud (= ARMeshAnchor。 anchor ごとに TRIANGLE_LIST Marker 1 つ) ──
        mesh_path = os.path.join(session_dir, "mesh.jsonl")
        if os.path.exists(mesh_path):
            import base64

            all_world_verts = []
            marker_id = 0
            with open(mesh_path) as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    row = json.loads(line)
                    verts = np.frombuffer(base64.b64decode(row["vertices_b64"]), dtype="<f4").reshape(-1, 3)
                    faces = np.frombuffer(base64.b64decode(row["faces_b64"]), dtype="<u4").reshape(-1, 3)
                    t4 = np.asarray(row["transform"], dtype=np.float64)  # row-major 4x4 (anchor → world)
                    world = verts @ t4[:3, :3].T + t4[:3, 3]
                    all_world_verts.append(world.astype("<f4"))
                    # TRIANGLE_LIST: 頂点を面ごとに展開して points に並べる
                    tri_pts = world[faces.reshape(-1)]
                    write("/map/mesh", "visualization_msgs/Marker", {
                        "header": {"stamp": _stamp(last_ts), "frame_id": "world"},
                        "ns": "mesh",
                        "id": marker_id,
                        "type": 11,   # TRIANGLE_LIST
                        "action": 0,  # ADD
                        "pose": {
                            "position": {"x": 0.0, "y": 0.0, "z": 0.0},
                            "orientation": {"x": 0.0, "y": 0.0, "z": 0.0, "w": 1.0},
                        },
                        "scale": {"x": 1.0, "y": 1.0, "z": 1.0},
                        "color": {"r": 0.8, "g": 0.8, "b": 0.8, "a": 1.0},
                        "points": [{"x": float(p[0]), "y": float(p[1]), "z": float(p[2])} for p in tri_pts],
                        "colors": [],
                    }, last_ts)
                    marker_id += 1
            if all_world_verts:
                merged = np.concatenate(all_world_verts, axis=0)
                write("/map/mesh_cloud", "sensor_msgs/PointCloud2",
                      _point_cloud2_msg(last_ts, np.ascontiguousarray(merged).tobytes(), len(merged)), last_ts)
                stats["mesh_anchors"] = marker_id

        writer.finish()

    return {
        "stats": stats,
        "durationMs": int((time.time() - t0) * 1000),
        "outputBytes": os.path.getsize(out_path),
        "jsonlFrames": len(frames_meta),
    }


# ─── R2 入出力 (= 決定論的キーへの上書きで冪等) ────────────────────────

SESSION_FILES = ["rgb.mp4", "realtime_handpose.jsonl", "imu.jsonl", "metadata.json", "depth.tar", "pointcloud.jsonl", "mesh.jsonl"]


def _r2_client():
    import boto3

    account_id = os.environ["R2_ACCOUNT_ID"]
    return boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )


def process_session(signature_hash: str, blur_model: str = "mediapipe", jpeg_quality: int = 85) -> dict:
    """raw/<hash>/ を取得 → build_mcap → rootlens-fpvlabs/<hash>/session.mcap に上書き。"""
    s3 = _r2_client()
    bucket_raw = os.environ.get("R2_BUCKET_RAW_ARKIT", "rootlens-raw-arkit")
    bucket_out = os.environ.get("R2_BUCKET_FPVLABS", "rootlens-fpvlabs")

    with tempfile.TemporaryDirectory() as tmp:
        session_dir = os.path.join(tmp, "session")
        os.makedirs(session_dir)
        for name in SESSION_FILES:
            key = f"raw/{signature_hash}/{name}"
            dest = os.path.join(session_dir, name)
            try:
                s3.download_file(bucket_raw, key, dest)
            except Exception:
                if name in ("rgb.mp4", "realtime_handpose.jsonl", "metadata.json"):
                    raise RuntimeError(f"required input missing: {key}")
                # depth.tar / imu.jsonl はオプショナル

        out_path = os.path.join(tmp, "session.mcap")
        result = build_mcap(session_dir, out_path, blur_model=blur_model, jpeg_quality=jpeg_quality)

        out_key = f"{signature_hash}/session.mcap"
        s3.upload_file(out_path, bucket_out, out_key, ExtraArgs={"ContentType": "application/octet-stream"})
        result["outputKey"] = f"{bucket_out}/{out_key}"
        return result


# ─── Modal wiring ──────────────────────────────────────────────────────

try:
    import modal

    image = (
        modal.Image.debian_slim(python_version="3.11")
        .apt_install("libgl1", "libglib2.0-0", "libegl1", "libgles2")  # mediapipe が GLES を要求
        .pip_install(
            "numpy", "opencv-python-headless", "boto3",
            "mcap", "mcap-ros2-support", "stera-sdk", "mediapipe",
        )
    )
    app = modal.App("rootlens-fpvlabs")

    @app.function(
        image=image,
        timeout=3600,
        memory=8192,
        cpu=4.0,
        secrets=[modal.Secret.from_name("r2-creds")],
    )
    def fpvlabs_process(signature_hash: str, blur_model: str = "mediapipe", jpeg_quality: int = 85) -> dict:
        return process_session(signature_hash, blur_model=blur_model, jpeg_quality=jpeg_quality)

    @app.local_entrypoint()
    def main(signature_hash: str, blur_model: str = "mediapipe", jpeg_quality: int = 85):
        print(json.dumps(fpvlabs_process.remote(signature_hash, blur_model, jpeg_quality), indent=2))

except ImportError:
    modal = None  # ローカル実行 (= python fpvlabs.py <hash>) では modal 不要


if __name__ == "__main__" and (modal is None or os.environ.get("FPVLABS_LOCAL")):
    import sys

    print(json.dumps(process_session(sys.argv[1]), indent=2))

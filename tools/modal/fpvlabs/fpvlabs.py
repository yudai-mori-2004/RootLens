# pipeline-fpvlabs: raw セッション → (任意) 顔ぼかし → Stera 互換 raw MCAP。
#
# FPV Labs (https://fpvlabs.ai/stera) へのデータ受け渡し用。 rootlens-raw-arkit の
# raw/<content_hash>/ を読み、 任意で顔ぼかしを適用した上で (= --blur/--no-blur、 既定オン)
# stera-sdk の MCAPReader がそのまま読める ROS2 スキーマの MCAP を組み立て、
# rootlens-fpvlabs バケットへ書く。 撮影者は写っている人全員の許可を取得済み (= ぼかしは追加保護)。
#
# 顔検出器は EgoBlur (= Stera-10M と同じ、 Meta gen2 TorchScript) が既定。
# GPU で batch 推論、 短辺リサイズを効かせて 1 時間あたり数十円を狙う (詳細は EGOBLUR_* 定数)。
# 検出器の切替: --face-detector egoblur|mediapipe (mediapipe は CPU 動作の fallback)。
#
#   入力: raw/<hash>/{rgb.mp4, frames.jsonl, imu.jsonl, metadata.json[, depth.tar]}
#         (frames.jsonl は旧収録では realtime_handpose.jsonl。 どちらか必須)
#   出力: <hash>/session.mcap  (= 決定論的キー。 再実行は同キーへの上書き = 冪等)
#
# トピック構成は stera-sdk の TopicConfig (data/mcap/_reader.py) に一致させる:
#   /camera/rgb/compressed   sensor_msgs/CompressedImage (JPEG、 --blur 時のみ顔ぼかし適用)
#   /camera/depth            sensor_msgs/Image 16UC1 (mm)      ← depth.tar がある場合のみ
#   /camera/depth/confidence sensor_msgs/Image mono8 (0=low/1=med/2=high) ← 新収録 (confidence/ 入り tar) のみ
#   /camera/camera_info      sensor_msgs/CameraInfo
#   /camera/depth/camera_info sensor_msgs/CameraInfo           ← 同上
#   /camera/pose             geometry_msgs/PoseStamped (ARKit world、 ARKit-native 軸)
#   /camera/tracking_state   stera_msgs/TrackingState
#   /device/imu              sensor_msgs/Imu (m/s^2、 CoreMotion 軸のまま)
#   /tf                      tf2_msgs/TFMessage (camera_link → camera_optical_frame)
#   /trajectory              nav_msgs/Path
#   /rootlens/processing_info std_msgs/String (JSON: ぼかし有無・モデル・検出閾値・pipeline version)
#
# 冪等性: 出力キーは content_hash から決定論的。 ローカル一時ファイルに全て書いてから
# 1 回の put_object / multipart で上書きする (= 半端な状態がバケットに残らない)。
# 設定を変えて再実行すれば同キーが新しい内容で置き換わり、 processing_info で判別できる。
#
# 事前セットアップ (Modal, 1 回だけ):
#   1. EgoBlur モデル jit を Modal Volume に置く:
#        modal volume create rootlens-egoblur
#        modal volume put rootlens-egoblur references/egoblur/ego_blur_face_gen2.jit /
#      jit は Meta EgoBlur の gen2 顔検出モデル (400MB)。 Modal image はビルド時に
#      https://github.com/facebookresearch/EgoBlur を clone するので、 gen2 ソースは自動で入る。
#
# 実行:
#   ローカル:  python tools/modal/fpvlabs/fpvlabs.py <content_hash>   (R2 creds は env で、 ぼかしオン)
#   Modal:    modal run --detach tools/modal/fpvlabs/fpvlabs.py --content-hash <hash>            (ぼかしオン)
#             modal run --detach tools/modal/fpvlabs/fpvlabs.py --content-hash <hash> --no-blur  (ぼかしオフ)
#             (--detach: クライアント切断やセッション終了でジョブを道連れにしない)
#   deploy:   modal deploy tools/modal/fpvlabs/fpvlabs.py

from __future__ import annotations

import io
import json
import os
import tarfile
import tempfile
import time

PIPELINE_VERSION = "fpvlabs-4"  # MCAP の processing_info に記録される変換パイプラインの版。 変換の挙動を変えたら上げる。

# ─── EgoBlur (既定) ──────────────────────────────────────────────
# Stera-10M と同じ検出器 (Meta gen2 EgoBlur、 arXiv:2308.13093)。
# 閾値は stera-sdk の既定に合わせる (= 0.8)。 Meta gen2 の per-camera calibrated 値は
# camera-rgb で 0.674 (Aria RGB 想定) だが、 stera-sdk (fpvlabs 本家) は 0.8 で運用しており、
# iPhone RGB での calibration が無いため本家の運用値をそのまま採用する。
EGOBLUR_SCORE_THRESHOLD = 0.8
EGOBLUR_NMS_IOU = 0.3
EGOBLUR_SCALE_FACTOR = 1.15  # 検出 bbox を 15% 拡張してからぼかす (境界の取りこぼし対策)

# 短辺リサイズ。 EgoBlur 既定 1200 は精度重視。 480 まで落として ~6 倍高速化 (推論は O(HW))。
# エゴセントリックの実顔は近距離〜中距離で数百 px 出るので、 480 でも捕まえられる
# (実運用でもし取りこぼしが確認されたら 640 に戻す)。
EGOBLUR_RESIZE = 480
EGOBLUR_BATCH = 16  # GPU の VRAM 内で回るバッチ数。 A10G 24GB なら余裕。

# コンテナ内での配置 (image ビルドで clone / volume mount で jit を配置)
EGOBLUR_CODE_DIR = "/opt/egoblur"                     # git clone 先 (gen2/script/... が入る)
EGOBLUR_JIT_PATH = "/egoblur_model/ego_blur_face_gen2.jit"  # modal volume の mount 先

# ─── Mediapipe (fallback) ────────────────────────────────────────
# 家事映像で手や床を顔と誤検出しやすいので、 EgoBlur が使えない場合の緊急時のみ。
# min_detection_confidence は 0.9 まで上げて誤検出を潰す (実測で 0.9 なら誤爆ゼロ)。
FACE_BLUR_MIN_CONFIDENCE = 0.9

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


# ─── 顔ぼかし backend (= EgoBlur GPU / mediapipe CPU) ─────────────


def _apply_elliptical_blur(rgb, boxes_xyxy, scale_factor: float):
    """EgoBlur gen2 demo と同じ楕円 blur を bbox 群に対して合成。 boxes は元解像度 XYXY。"""
    import cv2
    import numpy as np
    if not len(boxes_xyxy):
        return rgb
    h, w = rgb.shape[:2]
    out = rgb.copy()
    mask = np.zeros((h, w), np.uint8)
    ksize = (max(1, h // 2), max(1, w // 2))
    for x1, y1, x2, y2 in boxes_xyxy:
        cx = (x1 + x2) * 0.5
        cy = (y1 + y2) * 0.5
        bw = (x2 - x1) * scale_factor
        bh = (y2 - y1) * scale_factor
        x1i = max(0, int(round(cx - bw * 0.5)))
        y1i = max(0, int(round(cy - bh * 0.5)))
        x2i = min(w, int(round(cx + bw * 0.5)))
        y2i = min(h, int(round(cy + bh * 0.5)))
        if x2i <= x1i or y2i <= y1i:
            continue
        out[y1i:y2i, x1i:x2i] = cv2.blur(out[y1i:y2i, x1i:x2i], ksize)
        cv2.ellipse(mask, (((x1i + x2i) // 2, (y1i + y2i) // 2),
                          (x2i - x1i, y2i - y1i), 0), 255, -1)
    inv = cv2.bitwise_not(mask)
    bg = cv2.bitwise_and(rgb, rgb, mask=inv)
    fg = cv2.bitwise_and(out, out, mask=mask)
    return cv2.add(bg, fg)


class EgoBlurBackend:
    """Meta EgoBlur gen2 (TorchScript) 経由の顔検出 → ぼかし。 GPU 前提。 batch 推論対応。

    stera-sdk の EgoBlurFace ラッパーは detectron2 の名前空間衝突で動かないので、
    gen2 の EgoblurDetector を直接叩く (demo と同じ経路)。
    """

    NAME = "egoblur"

    def __init__(self, jit_path: str, code_dir: str, device: str,
                 score_threshold: float, nms_iou: float, resize: int,
                 batch: int, scale_factor: float):
        import sys
        # gen2 パッケージを path に (= `import gen2.script.*` を解決)
        if code_dir not in sys.path:
            sys.path.insert(0, code_dir)
        # gen2/script も path に (= jit の scripted 名 `detectron2.*` を bare で解決)
        script_dir = os.path.join(code_dir, "gen2", "script")
        if os.path.isdir(script_dir) and script_dir not in sys.path:
            sys.path.insert(0, script_dir)

        from gen2.script.detectron2.export.torchscript_patch import patch_instances
        from gen2.script.predictor import (
            EgoblurDetector, ClassID, PATCH_INSTANCES_FIELDS,
        )
        self._patch_instances = patch_instances
        self._patch_fields = PATCH_INSTANCES_FIELDS
        self._scale_factor = scale_factor
        self._batch = batch
        self.detector = EgoblurDetector(
            model_path=jit_path, device=device, detection_class=ClassID.FACE,
            score_threshold=score_threshold, nms_iou_threshold=nms_iou,
            resize_aug={"min_size_test": resize, "max_size_test": resize},
            image_format="BGR", use_gpu_resize=(device == "cuda"),
        )
        self.batch_size = batch
        self.detections_total = 0

    def blur_batch(self, bgr_frames):
        """bgr_frames: list of HxWx3 uint8 BGR。 検出+ぼかし後の RGB list を返す (同順)。"""
        import cv2
        import numpy as np
        import torch
        if not bgr_frames:
            return []
        tensors = [torch.from_numpy(np.transpose(f, (2, 0, 1))) for f in bgr_frames]
        batched = torch.stack(tensors)
        with self._patch_instances(fields=self._patch_fields):
            boxes_per_frame = self.detector.run(batched)  # score_threshold で絞り込み済
        outs = []
        for bgr, boxes in zip(bgr_frames, boxes_per_frame):
            self.detections_total += len(boxes)
            rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
            outs.append(_apply_elliptical_blur(rgb, boxes, self._scale_factor))
        return outs


class MediapipeBackend:
    """CPU 動作の fallback。 EgoBlur が使えないときだけ。 batch 非対応 (1 枚ずつ)。"""

    NAME = "mediapipe"

    def __init__(self, min_confidence: float):
        from stera.models import FaceBlurrer
        self._blurrer = FaceBlurrer(model="mediapipe", min_detection_confidence=min_confidence)
        self.batch_size = 1
        self.detections_total = 0  # mediapipe は「検出があったフレーム数」近似 (blur が新配列を返したか)

    def blur_batch(self, bgr_frames):
        import cv2
        outs = []
        for bgr in bgr_frames:
            rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
            out_rgb = self._blurrer.blur(rgb)
            if out_rgb is not rgb:
                self.detections_total += 1
            outs.append(out_rgb)
        return outs


def _make_face_backend(face_detector: str):
    """face_detector 名 → backend インスタンス。 build_mcap 内で 1 回だけ呼ぶ。"""
    if face_detector == "egoblur":
        import torch
        device = "cuda" if torch.cuda.is_available() else "cpu"
        return EgoBlurBackend(
            jit_path=EGOBLUR_JIT_PATH, code_dir=EGOBLUR_CODE_DIR, device=device,
            score_threshold=EGOBLUR_SCORE_THRESHOLD, nms_iou=EGOBLUR_NMS_IOU,
            resize=EGOBLUR_RESIZE, batch=EGOBLUR_BATCH,
            scale_factor=EGOBLUR_SCALE_FACTOR,
        )
    if face_detector == "mediapipe":
        return MediapipeBackend(min_confidence=FACE_BLUR_MIN_CONFIDENCE)
    raise ValueError(f"unknown face_detector: {face_detector}")


# ─── MCAP 組み立て本体 (= ストリーミング。 フレームをメモリに溜めない) ──


def build_mcap(session_dir: str, out_path: str, blur: bool = True,
               face_detector: str = "egoblur", jpeg_quality: int = 85) -> dict:
    """raw セッションを Stera 互換 MCAP に組み立てる。

    blur=True (既定) のとき、 RGB 各フレームに顔ぼかしを適用する。 face_detector で検出器を選ぶ
    ("egoblur" = 既定、 GPU、 Stera-10M と同じ / "mediapipe" = CPU fallback)。
    blur=False で完全に無効化。
    """
    import cv2
    import numpy as np
    from mcap_ros2.writer import Writer as Ros2Writer

    t0 = time.time()

    meta = json.load(open(os.path.join(session_dir, "metadata.json")))
    cam = meta["camera"]

    # per-frame 行 (= pose / tracking / intrinsics / timestamp)。 1 行 ~1KB なので全読みで問題ない。
    # 新収録は frames.jsonl、 旧収録は realtime_handpose.jsonl (= 同一スキーマの旧名)。
    frames_path = os.path.join(session_dir, "frames.jsonl")
    if not os.path.exists(frames_path):
        frames_path = os.path.join(session_dir, "realtime_handpose.jsonl")
    frames_meta: list[dict] = []
    with open(frames_path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            frames_meta.append(row)
    if not frames_meta:
        raise RuntimeError(f"{os.path.basename(frames_path)} is empty")

    # 顔ぼかし (= blur=True のときだけ初期化)。 既定は EgoBlur (GPU、 Stera-10M と同じ)。
    face_backend = _make_face_backend(face_detector) if blur else None

    stats = {"rgb": 0, "depth": 0, "confidence": 0, "pose": 0, "imu": 0, "tracking": 0, "point_cloud": 0, "mesh_anchors": 0}

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
        blur_meta = {"detector": None, "threshold": None, "resize": None}
        if blur:
            blur_meta["detector"] = face_detector
            if face_detector == "egoblur":
                blur_meta["threshold"] = EGOBLUR_SCORE_THRESHOLD
                blur_meta["resize"] = EGOBLUR_RESIZE
            elif face_detector == "mediapipe":
                blur_meta["threshold"] = FACE_BLUR_MIN_CONFIDENCE
        write("/rootlens/processing_info", "std_msgs/String", {"data": json.dumps({
            "pipeline_version": PIPELINE_VERSION,
            "blur": blur,
            "blur_detector": blur_meta["detector"],
            "blur_threshold": blur_meta["threshold"],
            "blur_resize": blur_meta["resize"],
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

        # ── /camera/rgb/compressed (= デコード → (任意) ぼかし → JPEG) ──
        # ぼかしを GPU で回すため、 face_backend.batch_size フレームずつ束ねて blur_batch する。
        # backend=None (ぼかしオフ) や mediapipe (batch_size=1) では実質 1 フレームずつと同じ。
        batch_size = face_backend.batch_size if face_backend is not None else 1

        # RGB フレームのタイムスタンプは jsonl 行とのインデックス 1:1 対応が前提。
        # 範囲外 = 端末側で行と mp4 フレームがずれた不整合データなので、 捏造せず即失敗する。
        def _timestamp_for(idx: int) -> int:
            if idx >= len(frames_meta):
                raise RuntimeError(
                    f"rgb.mp4 has more frames than pose rows in frames.jsonl "
                    f"(frame index {idx} >= {len(frames_meta)} rows); refusing to fabricate timestamps"
                )
            return int(frames_meta[idx]["timestamp_ns"])

        def _flush_batch(bgr_batch, i_batch):
            # ぼかしを掛けて (or そのまま RGB 化して) JPEG 化 → MCAP 書き込み
            if face_backend is not None:
                rgb_batch = face_backend.blur_batch(bgr_batch)
            else:
                rgb_batch = [cv2.cvtColor(b, cv2.COLOR_BGR2RGB) for b in bgr_batch]
            for idx, out_rgb in zip(i_batch, rgb_batch):
                ok_enc, jpg = cv2.imencode(".jpg", cv2.cvtColor(out_rgb, cv2.COLOR_RGB2BGR),
                                           [int(cv2.IMWRITE_JPEG_QUALITY), jpeg_quality])
                if not ok_enc:
                    raise RuntimeError(f"jpeg encode failed at frame {idx}")
                ts = _timestamp_for(idx)
                write("/camera/rgb/compressed", "sensor_msgs/CompressedImage", {
                    "header": {"stamp": _stamp(ts), "frame_id": "camera_optical_frame"},
                    "format": "jpeg",
                    "data": jpg.tobytes(),
                }, ts)
                stats["rgb"] += 1

        cap = cv2.VideoCapture(os.path.join(session_dir, "rgb.mp4"))
        try:
            bgr_batch: list = []
            i_batch: list = []
            i = 0
            while True:
                ok, bgr = cap.read()
                if not ok:
                    break
                bgr_batch.append(bgr)
                i_batch.append(i)
                i += 1
                if len(bgr_batch) >= batch_size:
                    _flush_batch(bgr_batch, i_batch)
                    bgr_batch = []
                    i_batch = []
            if bgr_batch:
                _flush_batch(bgr_batch, i_batch)
        finally:
            cap.release()

        # 検品: mp4 のフレーム数と pose 行数は端末側の設計で厳密に一致する。 ずれていたら
        # RGB のタイムスタンプ / pose 対応が壊れたデータなので、 納品せずここで止める。
        if i != len(frames_meta):
            raise RuntimeError(
                f"frame/pose count mismatch: rgb.mp4 decoded {i} frames but "
                f"frames.jsonl has {len(frames_meta)} rows; "
                f"RGB timestamps would be misaligned, aborting"
            )

        # ── /camera/depth + /camera/depth/confidence (= depth.tar がある場合のみ) ──
        # tar 内は depth/<idx>.png (16-bit PNG、 mm → 16UC1)。 新しい収録では同じ index の
        # confidence/<idx>.png (= ARKit sceneDepth.confidenceMap、 8-bit で 0=low / 1=medium / 2=high)
        # が並ぶので mono8 で別トピックに出す。 旧収録 (confidence 無し) はそのまま depth だけになる。
        depth_tar = os.path.join(session_dir, "depth.tar")
        if os.path.exists(depth_tar):
            with tarfile.open(depth_tar) as tar:
                for member in tar:
                    if not member.isfile() or not member.name.endswith(".png"):
                        continue
                    idx = int(os.path.splitext(os.path.basename(member.name))[0])
                    buf = tar.extractfile(member).read()
                    img = cv2.imdecode(np.frombuffer(buf, np.uint8), cv2.IMREAD_UNCHANGED)
                    if img is None:
                        continue
                    if idx >= len(frames_meta):
                        raise RuntimeError(
                            f"depth.tar entry index {idx} out of range ({len(frames_meta)} pose rows)"
                        )
                    ts = int(frames_meta[idx]["timestamp_ns"])
                    h, w = img.shape[:2]
                    if member.name.startswith("confidence/"):
                        if img.dtype != np.uint8:
                            continue
                        write("/camera/depth/confidence", "sensor_msgs/Image", {
                            "header": {"stamp": _stamp(ts), "frame_id": "camera_optical_frame"},
                            "height": int(h), "width": int(w),
                            "encoding": "mono8", "is_bigendian": 0, "step": int(w),
                            "data": np.ascontiguousarray(img).tobytes(),
                        }, ts)
                        stats["confidence"] += 1
                    else:
                        if img.dtype != np.uint16:
                            continue
                        write("/camera/depth", "sensor_msgs/Image", {
                            "header": {"stamp": _stamp(ts), "frame_id": "camera_optical_frame"},
                            "height": int(h), "width": int(w),
                            "encoding": "16UC1", "is_bigendian": 0, "step": int(w * 2),
                            "data": np.ascontiguousarray(img).tobytes(),
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

    detections_total = face_backend.detections_total if face_backend is not None else 0
    return {
        "stats": stats,
        "blur": blur,
        "faceDetector": face_detector if blur else None,
        "detectionsTotal": detections_total,
        "durationMs": int((time.time() - t0) * 1000),
        "outputBytes": os.path.getsize(out_path),
        "jsonlFrames": len(frames_meta),
    }


# ─── R2 入出力 (= 決定論的キーへの上書きで冪等) ────────────────────────

SESSION_FILES = ["rgb.mp4", "frames.jsonl", "realtime_handpose.jsonl", "imu.jsonl", "metadata.json", "depth.tar", "pointcloud.jsonl", "mesh.jsonl"]


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


def process_session(content_hash: str, blur: bool = True,
                    face_detector: str = "egoblur", jpeg_quality: int = 85,
                    target_bucket: str | None = None) -> dict:
    """raw/<hash>/ を取得 → build_mcap → <target_bucket>/<hash>/session.mcap に上書き。

    blur=False で顔ぼかしを無効化 (= raw の生映像そのまま)。
    target_bucket が None のときは環境変数 R2_BUCKET_FPVLABS (既定 rootlens-fpvlabs = 本番) を使う。
    検証時は本番以外の書ける R2 バケットを指定すること。"""
    s3 = _r2_client()
    bucket_raw = os.environ.get("R2_BUCKET_RAW_ARKIT", "rootlens-raw-arkit")
    bucket_out = target_bucket or os.environ.get("R2_BUCKET_FPVLABS", "rootlens-fpvlabs")

    with tempfile.TemporaryDirectory() as tmp:
        session_dir = os.path.join(tmp, "session")
        os.makedirs(session_dir)
        for name in SESSION_FILES:
            key = f"raw/{content_hash}/{name}"
            dest = os.path.join(session_dir, name)
            try:
                s3.download_file(bucket_raw, key, dest)
            except Exception:
                if name in ("rgb.mp4", "metadata.json"):
                    raise RuntimeError(f"required input missing: {key}")
                # frames.jsonl / realtime_handpose.jsonl は下でどちらか必須をチェック。
                # depth.tar / imu.jsonl 等はオプショナル。
        if not os.path.exists(os.path.join(session_dir, "frames.jsonl")) and \
           not os.path.exists(os.path.join(session_dir, "realtime_handpose.jsonl")):
            raise RuntimeError(f"required input missing: raw/{content_hash}/frames.jsonl (or legacy realtime_handpose.jsonl)")

        out_path = os.path.join(tmp, "session.mcap")
        result = build_mcap(session_dir, out_path, blur=blur,
                            face_detector=face_detector, jpeg_quality=jpeg_quality)

        out_key = f"{content_hash}/session.mcap"
        s3.upload_file(out_path, bucket_out, out_key, ExtraArgs={"ContentType": "application/octet-stream"})
        result["outputKey"] = f"{bucket_out}/{out_key}"
        return result


# ─── Modal wiring ──────────────────────────────────────────────────────

try:
    import modal

    # EgoBlur repo を build 時に clone (gen2/script/... と detectron2 vendored 版が入る)。
    # commit を pin して再現性を確保。 jit モデル (400MB) は build に混ぜず、
    # 別途 modal volume `rootlens-egoblur` にユーザが 1 回 put する (docstring 参照)。
    EGOBLUR_COMMIT = "main"  # 実運用が固まったら固定ハッシュに差し替え

    image = (
        modal.Image.debian_slim(python_version="3.11")
        .apt_install(
            "libgl1", "libglib2.0-0",           # opencv / mediapipe が要求
            "libegl1", "libgles2",
            "git",                               # EgoBlur clone 用
        )
        .pip_install(
            # 共通
            "numpy<2", "opencv-python-headless", "boto3",
            "mcap", "mcap-ros2-support", "stera-sdk==0.0.4",
            # mediapipe backend (fallback)
            "mediapipe",
            # egoblur backend (Meta gen2)。 torch は CUDA 版 (Modal image が cuda 対応)。
            "torch", "torchvision", "tqdm",
            "moviepy<2.0",  # egoblur package の import 時に必要
        )
        .run_commands(
            f"git clone --depth 1 https://github.com/facebookresearch/EgoBlur {EGOBLUR_CODE_DIR}",
        )
    )

    # EgoBlur jit を置く persistent volume。 事前に:
    #   modal volume create rootlens-egoblur
    #   modal volume put rootlens-egoblur references/egoblur/ego_blur_face_gen2.jit /
    egoblur_volume = modal.Volume.from_name("rootlens-egoblur", create_if_missing=True)

    app = modal.App("rootlens-fpvlabs")

    @app.function(
        image=image,
        gpu="L4",                                # egoblur 推論用。 L4 は A10G より 25% 安く、
                                                 # FasterRCNN gen2 の処理には十分。
        timeout=7200,                            # 60 分クリップまで余裕を持たせる
        memory=16384,
        cpu=4.0,
        volumes={"/egoblur_model": egoblur_volume},
        secrets=[modal.Secret.from_name("r2-creds")],
    )
    def fpvlabs_process(content_hash: str, blur: bool = True,
                        face_detector: str = "egoblur", jpeg_quality: int = 85,
                        target_bucket: str = "") -> dict:
        return process_session(content_hash, blur=blur,
                               face_detector=face_detector, jpeg_quality=jpeg_quality,
                               target_bucket=target_bucket or None)

    @app.local_entrypoint()
    def main(content_hash: str, blur: bool = True,
             face_detector: str = "egoblur", jpeg_quality: int = 85,
             target_bucket: str = ""):
        # ぼかし切替:   --blur (既定) / --no-blur
        # 検出器切替:   --face-detector egoblur (既定、 Stera-10M と同じ) / mediapipe (CPU fallback)
        # 出力先切替:   --target-bucket <bucket>  (空 = 既定 rootlens-fpvlabs = 本番)
        #              検証やチューニングは自分専用の別バケットを指定して本番に触れないようにする。
        print(json.dumps(
            fpvlabs_process.remote(content_hash, blur, face_detector, jpeg_quality, target_bucket),
            indent=2,
        ))

except ImportError:
    modal = None  # ローカル実行 (= python fpvlabs.py <hash>) では modal 不要


if __name__ == "__main__" and (modal is None or os.environ.get("FPVLABS_LOCAL")):
    import sys

    print(json.dumps(process_session(sys.argv[1]), indent=2))

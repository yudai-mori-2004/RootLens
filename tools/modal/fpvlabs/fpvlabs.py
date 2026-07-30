# pipeline-fpvlabs: raw セッション → (任意) 顔ぼかし → ROS2 スキーマの納品 MCAP。
#
# FPV Labs へのデータ受け渡し用。 rootlens-raw-arkit の raw/<content_hash>/ を読み、
# 任意で顔ぼかしを適用した上で (= --blur/--no-blur、 既定オン) ROS2 スキーマの MCAP を
# 時系列インターリーブで組み立て、 rootlens-fpvlabs バケットへ書く。
# 撮影者は写っている人全員の許可を取得済み (= ぼかしは追加保護)。
#
# 顔検出器は EgoBlur (Meta gen2 TorchScript、 arXiv:2308.13093) が既定。
# GPU で batch 推論、 短辺リサイズを効かせて 1 時間あたり数十円を狙う (詳細は EGOBLUR_* 定数)。
# 検出器の切替: --face-detector egoblur|mediapipe (mediapipe は CPU 動作の fallback)。
#
#   入力: raw/<hash>/{rgb.mp4, frames.jsonl, imu.jsonl, metadata.json[, depth.tar,
#         pointcloud.jsonl, mesh.jsonl, arkit_imu.jsonl, device_metrics.jsonl]}
#         (frames.jsonl は旧収録では realtime_handpose.jsonl。 どちらか必須。
#          arkit_imu / device_metrics は新収録のみ = 無いセッションではトピックが空になるだけ)
#   出力: <hash>/session.mcap  (= 決定論的キー。 再実行は同キーへの上書き = 冪等)
#
# チャンネルは CHANNELS の固定順で全て先行登録し (= データが無いトピックも登録だけは残る)、
# メッセージは撮影時刻順にインターリーブして書く。 トピック一覧と型は CHANNELS を参照。
# 主要な値の規約:
#   /camera/pose             ARKit world、 ARKit-native 軸のまま
#   /device/imu              m/s^2 (重力込みの比力 = REP 145)、 CoreMotion 軸、 covariance は全ゼロ = 不明
#   /camera/depth            16UC1 (mm)。 /camera/depth/confidence は mono8 0=low/1=med/2=high
#   /tf                      毎 pose: world→camera_link + camera_link→camera_optical_frame (180° X 回転)
#   /trajectory              5 秒ごとの増分 Path (書くたびにバッファを空にする)
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

import datetime as dt
import io
import json
import os
import tarfile
import tempfile
import time

PIPELINE_VERSION = "fpvlabs-5"  # MCAP の processing_info に記録される変換パイプラインの版。 変換の挙動を変えたら上げる。

# ─── manifest (バケット同梱の属性テーブル) ─────────────────────────
# 納品バケットはフラットな <hash>/session.mcap のまま、 セッションの属性 (ドメイン等) は
# バケット直下の manifest.jsonl 1 ファイルで伝える。 中身は毎回 DB + R2 の実状態から
# まるごと再生成する派生物 (= どこにもメモを持たない)。 全再生成なので並列実行が
# 同時に書いても last-writer-wins で収束し、 取りこぼしは次の実行が自己修復する。
#
# domain / site の正は DB の accounts テーブル (account_id → 匿名の現場コード)。
# accounts に行が無いアカウント (テスト端末など) のクリップは GPU を回す前に fail-loud で止める。

# ─── EgoBlur (既定) ──────────────────────────────────────────────
# Meta gen2 EgoBlur (arXiv:2308.13093)。 閾値 0.8 は運用実績値。
# Meta gen2 の per-camera calibrated 値は camera-rgb で 0.674 (Aria RGB 想定) だが、
# iPhone RGB での calibration が無いため保守側の 0.8 を採用する。
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

# ─── 撮影禁止マーカー (ArUco) ────────────────────────────────────
# 店側が「映したくない場所」 に貼る物理ステッカー。 検出とぼかしは納品パイプライン (= ここ) だけで
# 行い、 マーカー周囲の実寸ゾーンを塗りつぶす。 ArUco なのは同寸の QR よりセルが大きく、 数倍の
# 距離やモーションブラー越しでも検出できるため。 シートは tools/asset-gen/gen-ng-markers.py で
# 生成し、 原寸印刷が前提 (= マーカー実寸がゾーンの cm → px 換算の基準)。
NG_MARKER_DICT = "DICT_4X4_50"
NG_MARKER_SIZE_CM = 7.0      # 印刷したマーカー黒枠 1 辺の実寸 (= gen-ng-markers.py の出力と一致させる)
NG_MARKER_CORROBORATE_S = 3.0  # 単発ノイズ棄却の裏付け窓 (同一 id の別目撃がこの秒数以内に必要)
NG_MARKER_ZONE_SCALE = 1.15  # ゾーンを少し広げて適用 (境界の取りこぼし対策。 顔ぼかしと同率)
# id → ぼかしゾーン (シートの表記と 1:1 に保つ)。 circle はマーカー中心の半径 r_cm、
# rect はマーカー中心に置く w_cm × h_cm (貼った向きに追従)。
NG_MARKER_ZONES: dict[int, dict] = {
    0: {"shape": "circle", "r_cm": 25.0},
    1: {"shape": "circle", "r_cm": 50.0},
    2: {"shape": "circle", "r_cm": 100.0},
    10: {"shape": "rect", "w_cm": 40.0, "h_cm": 30.0},
    11: {"shape": "rect", "w_cm": 90.0, "h_cm": 60.0},
    12: {"shape": "rect", "w_cm": 180.0, "h_cm": 90.0},
}

# ─── ROS2 スキーマ (= .msg 全文。 登録順ごと固定) ───────────────────────
#
# スキーマ本文が MCAP に埋め込まれる正本。 型参照は ROS2 正式の 3 部形式 (pkg/msg/Type)。
# エンコーダ (mcap_ros2 の serialize_dynamic) は 2 部形式しか解釈しないため、
# _McapOut が "/msg/" を落とした等価テキストからエンコーダを生成する (本文は無改変で登録)。

_HEADER_TIME_DEP = """================================================================================
MSG: std_msgs/msg/Header
builtin_interfaces/msg/Time stamp
string frame_id
================================================================================
MSG: builtin_interfaces/msg/Time
int32 sec
uint32 nanosec"""

_POSE_DEP = """================================================================================
MSG: geometry_msgs/msg/Pose
geometry_msgs/msg/Point position
geometry_msgs/msg/Quaternion orientation
================================================================================
MSG: geometry_msgs/msg/Point
float64 x
float64 y
float64 z
================================================================================
MSG: geometry_msgs/msg/Quaternion
float64 x
float64 y
float64 z
float64 w"""

_VEC3_DEP = """================================================================================
MSG: geometry_msgs/msg/Vector3
float64 x
float64 y
float64 z"""

# 登録順が schema id (1 始まり) を決める。 順序は納品先ツールの既存ファイルと揃えて固定。
SCHEMAS: list[tuple[str, str]] = [
    ("geometry_msgs/msg/PoseStamped", f"""std_msgs/msg/Header header
geometry_msgs/msg/Pose pose
{_HEADER_TIME_DEP}
{_POSE_DEP}"""),
    ("sensor_msgs/msg/Imu", f"""std_msgs/msg/Header header
geometry_msgs/msg/Quaternion orientation
float64[9] orientation_covariance
geometry_msgs/msg/Vector3 angular_velocity
float64[9] angular_velocity_covariance
geometry_msgs/msg/Vector3 linear_acceleration
float64[9] linear_acceleration_covariance
{_HEADER_TIME_DEP}
================================================================================
MSG: geometry_msgs/msg/Quaternion
float64 x
float64 y
float64 z
float64 w
{_VEC3_DEP}"""),
    ("sensor_msgs/msg/Image", f"""std_msgs/msg/Header header
uint32 height
uint32 width
string encoding
uint8 is_bigendian
uint32 step
uint8[] data
{_HEADER_TIME_DEP}"""),
    ("sensor_msgs/msg/CompressedImage", f"""std_msgs/msg/Header header
string format
uint8[] data
{_HEADER_TIME_DEP}"""),
    ("sensor_msgs/msg/PointCloud2", f"""std_msgs/msg/Header header
uint32 height
uint32 width
sensor_msgs/msg/PointField[] fields
bool is_bigendian
uint32 point_step
uint32 row_step
uint8[] data
bool is_dense
{_HEADER_TIME_DEP}
================================================================================
MSG: sensor_msgs/msg/PointField
string name
uint32 offset
uint8 datatype
uint32 count"""),
    ("visualization_msgs/msg/Marker", f"""std_msgs/msg/Header header
string ns
int32 id
int32 type
int32 action
geometry_msgs/msg/Pose pose
geometry_msgs/msg/Vector3 scale
std_msgs/msg/ColorRGBA color
builtin_interfaces/msg/Duration lifetime
bool frame_locked
geometry_msgs/msg/Point[] points
std_msgs/msg/ColorRGBA[] colors
string text
string mesh_resource
bool mesh_use_embedded_materials
{_HEADER_TIME_DEP}
{_POSE_DEP}
{_VEC3_DEP}
================================================================================
MSG: std_msgs/msg/ColorRGBA
float32 r
float32 g
float32 b
float32 a
================================================================================
MSG: builtin_interfaces/msg/Duration
int32 sec
uint32 nanosec"""),
    ("sensor_msgs/msg/CameraInfo", f"""std_msgs/msg/Header header
uint32 height
uint32 width
string distortion_model
float64[] d
float64[9] k
float64[9] r
float64[12] p
uint32 binning_x
uint32 binning_y
sensor_msgs/msg/RegionOfInterest roi
{_HEADER_TIME_DEP}
================================================================================
MSG: sensor_msgs/msg/RegionOfInterest
uint32 x_offset
uint32 y_offset
uint32 height
uint32 width
bool do_rectify"""),
    ("tf2_msgs/msg/TFMessage", f"""geometry_msgs/msg/TransformStamped[] transforms
================================================================================
MSG: geometry_msgs/msg/TransformStamped
std_msgs/msg/Header header
string child_frame_id
geometry_msgs/msg/Transform transform
{_HEADER_TIME_DEP}
================================================================================
MSG: geometry_msgs/msg/Transform
geometry_msgs/msg/Vector3 translation
geometry_msgs/msg/Quaternion rotation
{_VEC3_DEP}
================================================================================
MSG: geometry_msgs/msg/Quaternion
float64 x
float64 y
float64 z
float64 w"""),
    ("nav_msgs/msg/Path", f"""std_msgs/msg/Header header
geometry_msgs/msg/PoseStamped[] poses
{_HEADER_TIME_DEP}
================================================================================
MSG: geometry_msgs/msg/PoseStamped
std_msgs/msg/Header header
geometry_msgs/msg/Pose pose
{_POSE_DEP}"""),
    ("rootlens/msg/TrackingState", f"""std_msgs/msg/Header header
uint8 state
uint8 reason
string state_str
string reason_str
{_HEADER_TIME_DEP}"""),
    ("rootlens/msg/DeviceMetrics", f"""std_msgs/msg/Header header
float32 battery_level
uint8 battery_state
string battery_state_str
float32 cpu_usage
float64 memory_used_mb
float64 memory_available_mb
uint8 thermal_state
string thermal_state_str
string device_model
{_HEADER_TIME_DEP}"""),
    ("rootlens/msg/ImuIntrinsics", f"""std_msgs/msg/Header header
float64 accel_noise_density
float64 gyro_noise_density
float64 accel_bias_random_walk
float64 gyro_bias_random_walk
geometry_msgs/msg/Vector3 accel_bias
geometry_msgs/msg/Vector3 gyro_bias
uint32 sample_rate_hz
string source
{_HEADER_TIME_DEP}
{_VEC3_DEP}"""),
    ("std_msgs/msg/String", "string data"),
]

# 登録順が channel id (1 始まり) を決める。 データが無いトピックも登録は行う
# (= メッセージ 0 件のチャンネルとしてファイルに残る)。
CHANNELS: list[tuple[str, str]] = [
    ("/camera/pose", "geometry_msgs/msg/PoseStamped"),
    ("/device/imu", "sensor_msgs/msg/Imu"),
    ("/camera/depth", "sensor_msgs/msg/Image"),
    ("/camera/rgb/compressed", "sensor_msgs/msg/CompressedImage"),
    ("/map/point_cloud", "sensor_msgs/msg/PointCloud2"),
    ("/map/mesh", "visualization_msgs/msg/Marker"),
    ("/map/mesh_cloud", "sensor_msgs/msg/PointCloud2"),
    ("/camera/camera_info", "sensor_msgs/msg/CameraInfo"),
    ("/camera/depth/camera_info", "sensor_msgs/msg/CameraInfo"),
    ("/tf", "tf2_msgs/msg/TFMessage"),
    ("/device/camera_imu_extrinsics", "tf2_msgs/msg/TFMessage"),
    ("/trajectory", "nav_msgs/msg/Path"),
    ("/camera/tracking_state", "rootlens/msg/TrackingState"),
    ("/device/metrics", "rootlens/msg/DeviceMetrics"),
    ("/device/imu/intrinsics", "rootlens/msg/ImuIntrinsics"),
    ("/arkit/imu", "sensor_msgs/msg/Imu"),
    ("/arkit/imu/intrinsics", "rootlens/msg/ImuIntrinsics"),
    ("/camera/depth/confidence", "sensor_msgs/msg/Image"),
    ("/rootlens/processing_info", "std_msgs/msg/String"),
]


class _McapOut:
    """schema / channel を固定順で先行登録し、 通し番号 sequence 付きでメッセージを書く MCAP 出力。

    schema 本文は SCHEMAS の 3 部形式テキストをそのまま登録し、 CDR エンコーダは
    "/msg/" を落とした等価テキストから生成する (serialize_dynamic が 2 部形式のみ対応のため)。"""

    def __init__(self, f):
        from mcap.writer import Writer as McapWriter
        from mcap_ros2._dynamic import serialize_dynamic

        self._w = McapWriter(f, chunk_size=512 * 1024)
        self._w.start(profile="ros2", library=f"rootlens-fpvlabs/{PIPELINE_VERSION}")
        self._seq = 0
        self._encoders: dict[str, object] = {}
        schema_ids: dict[str, int] = {}
        for name, text in SCHEMAS:
            schema_ids[name] = self._w.register_schema(
                name=name, encoding="ros2msg", data=text.encode())
            pname = name.replace("/msg/", "/")
            self._encoders[name] = serialize_dynamic(pname, text.replace("/msg/", "/"))[pname]
        self._channels: dict[str, tuple[int, str]] = {}
        for topic, schema_name in CHANNELS:
            cid = self._w.register_channel(
                topic=topic, message_encoding="cdr", schema_id=schema_ids[schema_name])
            self._channels[topic] = (cid, schema_name)

    def write(self, topic: str, msg: dict, ts_ns: int) -> None:
        cid, schema_name = self._channels[topic]
        self._w.add_message(
            channel_id=cid, log_time=ts_ns, data=self._encoders[schema_name](msg),
            publish_time=ts_ns, sequence=self._seq)
        self._seq += 1

    def add_metadata(self, name: str, data: dict) -> None:
        self._w.add_metadata(name, data)

    def finish(self) -> None:
        self._w.finish()


_XYZC_FIELDS = [
    {"name": "x", "offset": 0, "datatype": 7, "count": 1},
    {"name": "y", "offset": 4, "datatype": 7, "count": 1},
    {"name": "z", "offset": 8, "datatype": 7, "count": 1},
    {"name": "confidence", "offset": 12, "datatype": 7, "count": 1},
]


def _point_cloud2_msg(ts_ns: int, xyz_f32, confidence: float = 1.0) -> dict:
    """xyz (N,3) float32 + 一律 confidence → x,y,z,confidence の PointCloud2 (point_step 16)。"""
    import numpy as np

    n = int(xyz_f32.shape[0])
    packed = np.empty((n, 4), dtype="<f4")
    packed[:, :3] = xyz_f32
    packed[:, 3] = confidence
    return {
        "header": {"stamp": _stamp(ts_ns), "frame_id": "world"},
        "height": 1,
        "width": n,
        "fields": _XYZC_FIELDS,
        "is_bigendian": False,
        "point_step": 16,
        "row_step": 16 * n,
        "data": np.ascontiguousarray(packed).tobytes(),
        "is_dense": True,
    }

TRACKING_STATE_STR = {0: "notAvailable", 1: "limited", 2: "normal"}
G_TO_MS2 = 9.80665
TRAJECTORY_INTERVAL_NS = 5_000_000_000  # /trajectory の増分書き出し間隔


def _stamp(ts_ns: int) -> dict:
    return {"sec": int(ts_ns // 1_000_000_000), "nanosec": int(ts_ns % 1_000_000_000)}


def _flatten_metadata(meta: dict) -> dict:
    """metadata.json を dot 区切り 1 段の str→str に潰す (MCAP Metadata record 用)。"""
    flat: dict[str, str] = {}

    def rec(prefix: str, v) -> None:
        if isinstance(v, dict):
            for k, vv in v.items():
                rec(f"{prefix}.{k}" if prefix else str(k), vv)
        elif isinstance(v, (list, tuple)):
            flat[prefix] = json.dumps(v, ensure_ascii=False)
        elif isinstance(v, bool):
            flat[prefix] = "true" if v else "false"
        elif v is None:
            flat[prefix] = ""
        else:
            flat[prefix] = str(v)

    rec("", meta)
    return flat


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
    # 端末側の姿勢は float32 精度で生成される。 CDR は float64 フィールドだが、 値の
    # 量子化粒度を収録経路と揃えるため float32 に丸めてから昇格する。
    return {"x": float(np.float32(x)), "y": float(np.float32(y)),
            "z": float(np.float32(z)), "w": float(np.float32(w))}


def _camera_info_msg(ts_ns: int, width: int, height: int, fx: float, fy: float, cx: float, cy: float) -> dict:
    k = [fx, 0.0, cx, 0.0, fy, cy, 0.0, 0.0, 1.0]
    return {
        "header": {"stamp": _stamp(ts_ns), "frame_id": "camera_optical_frame"},
        "height": int(height),
        "width": int(width),
        "distortion_model": "plumb_bob",
        "d": [],
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

    gen2 の EgoblurDetector を直接叩く (公式 demo と同じ経路。 上位ラッパーは
    detectron2 の名前空間衝突があり使わない)。
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
        import mediapipe as mp
        # model_selection=1 = full-range モデル (数 m 先の顔まで対象)。
        self._detector = mp.solutions.face_detection.FaceDetection(
            model_selection=1, min_detection_confidence=min_confidence)
        self._scale_factor = EGOBLUR_SCALE_FACTOR
        self.batch_size = 1
        self.detections_total = 0

    def blur_batch(self, bgr_frames):
        import cv2
        outs = []
        for bgr in bgr_frames:
            rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
            h, w = rgb.shape[:2]
            result = self._detector.process(rgb)
            boxes = []
            for det in (result.detections or []):
                rb = det.location_data.relative_bounding_box
                x1 = rb.xmin * w
                y1 = rb.ymin * h
                boxes.append((x1, y1, x1 + rb.width * w, y1 + rb.height * h))
            self.detections_total += len(boxes)
            outs.append(_apply_elliptical_blur(rgb, boxes, self._scale_factor))
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


# ─── 撮影禁止マーカー (= 検出プリパス + ゾーンぼかし) ─────────────────


def _ng_zone_from_corners(corners, zone_def):
    """ArUco の 4 隅 (4,2) から画面上のぼかしゾーンを作る。

    マーカーの上辺・左辺ベクトルを「面上の 1cm」 としたアフィン写像 (rect = 平行四辺形、
    circle = 楕円)。 ゾーンは最大 ±15 マーカー幅の外挿なので、 数ピクセルの角の差分から
    推定する射影 (遠近) 成分はノイズ増幅が大きく、 線形写像だけで貼る。"""
    import numpy as np

    c = np.asarray(corners, dtype=np.float32).reshape(4, 2)
    side_px = float(np.mean([np.linalg.norm(c[k] - c[(k + 1) % 4]) for k in range(4)]))
    if side_px <= 1.0:
        return None
    center = c.mean(axis=0)

    # ── ゾーンの面上オフセット (cm、 マーカー中心原点、 余裕率込み) ──
    if zone_def["shape"] == "circle":
        ts = np.linspace(0.0, 2.0 * np.pi, 32, endpoint=False)
        offs = np.stack([np.cos(ts), np.sin(ts)], axis=1) * (zone_def["r_cm"] * NG_MARKER_ZONE_SCALE)
    else:
        hw = zone_def["w_cm"] / 2.0 * NG_MARKER_ZONE_SCALE
        hh = zone_def["h_cm"] / 2.0 * NG_MARKER_ZONE_SCALE
        offs = np.array([[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]], dtype=np.float32)

    U = (c[1] - c[0]) / NG_MARKER_SIZE_CM  # 面上 1cm → px (上辺方向)
    V = (c[3] - c[0]) / NG_MARKER_SIZE_CM
    if zone_def["shape"] != "circle":
        # 紙の微妙な傾き (吊り下げ・検出ノイズ) でゾーンが斜めになると不自然なので、
        # ±20° 以内は画像軸にスナップ。 円は面内回転に不変なのでスナップ不要。
        ang = float(np.degrees(np.arctan2(U[1], U[0])))
        snapped = round(ang / 90.0) * 90.0
        if abs(ang - snapped) <= 20.0:
            rad = np.radians(snapped)
            U = np.array([np.cos(rad), np.sin(rad)], dtype=np.float32) * float(np.linalg.norm(U))
            V = np.array([-np.sin(rad), np.cos(rad)], dtype=np.float32) * float(np.linalg.norm(V))
    pts = center + np.outer(offs[:, 0], U) + np.outer(offs[:, 1], V)
    return ("poly", pts.astype(np.int32))


def detect_ng_marker_zones(video_path: str, corroborate_frames: int) -> dict[int, list]:
    """rgb.mp4 を 1 パス走査して撮影禁止マーカーを検出し、 フレーム番号 → ぼかしゾーン一覧の
    予定表を返す。 ゾーンを塗るのは実際にマーカーを目撃したフレームだけ (= カメラが動く
    一人称映像では、 目撃時点のジオメトリを時間方向に延長しても正しい画面位置にならない)。
    孤立した単発目撃はノイズとして捨てる (下のコメント参照)。
    マーカーが 1 つも映っていないセッションでは空 dict (= 後段の挙動は従来と同一)。"""
    import cv2
    import numpy as np  # noqa: F401  (cv2.aruco が内部で要求)

    aruco = cv2.aruco
    dictionary = aruco.getPredefinedDictionary(getattr(aruco, NG_MARKER_DICT))
    if hasattr(aruco, "ArucoDetector"):
        detector = aruco.ArucoDetector(dictionary, aruco.DetectorParameters())
        detect = detector.detectMarkers
    else:  # opencv < 4.7 の旧 API
        params = aruco.DetectorParameters_create()
        detect = lambda gray: aruco.detectMarkers(gray, dictionary, parameters=params)  # noqa: E731

    sightings: dict[int, list] = {}  # marker id → [(frame_idx, zone), ...] (frame 昇順)
    cap = cv2.VideoCapture(video_path)
    try:
        i = 0
        while True:
            ok, bgr = cap.read()
            if not ok:
                break
            corners, ids, _ = detect(cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY))
            if ids is not None:
                for c, mid in zip(corners, ids.reshape(-1).tolist()):
                    zone_def = NG_MARKER_ZONES.get(int(mid))
                    if zone_def is None:
                        continue
                    zone = _ng_zone_from_corners(c, zone_def)
                    if zone is not None:
                        sightings.setdefault(int(mid), []).append((i, zone))
            i += 1
    finally:
        cap.release()

    # 単発の孤立目撃はノイズとして捨てる。 環境中の高コントラストな模様が偶発的に
    # カタログ id へ復号されることがあり、 それは孤立フレームにしかならない。 物理的に
    # 貼られたステッカーは連続フレームの目撃列になるので、 同一 id の別の目撃が
    # corroborate_frames 以内に 1 つも無い目撃はゾーン化しない。
    for mid in list(sightings):
        seen = sightings[mid]
        kept = [s for k, s in enumerate(seen)
                if (k > 0 and s[0] - seen[k - 1][0] <= corroborate_frames)
                or (k + 1 < len(seen) and seen[k + 1][0] - s[0] <= corroborate_frames)]
        if kept:
            sightings[mid] = kept
        else:
            del sightings[mid]
        if len(kept) != len(seen):
            print(f"[ng] id={mid}: dropped {len(seen) - len(kept)} isolated sighting(s) as noise", flush=True)

    # 残った目撃列をクラスタ単位でログに出す (= どの時間帯に何が映ったか後から追える)。
    for mid, seen in sightings.items():
        clusters: list[list[int]] = []
        for f, _ in seen:
            if clusters and f - clusters[-1][1] <= corroborate_frames:
                clusters[-1][1] = f
            else:
                clusters.append([f, f])
        spans = ", ".join(f"{a}..{b}" for a, b in clusters)
        print(f"[ng] id={mid}: {len(seen)} sightings in {len(clusters)} cluster(s): frames {spans}", flush=True)

    # 目撃列 → 予定表: 目撃したフレームにそのままゾーンを載せる。
    schedule: dict[int, list] = {}
    for seen in sightings.values():
        for f, zone in seen:
            schedule.setdefault(f, []).append(zone)
    return schedule


def _apply_zone_blur(rgb, zones):
    """マーカーゾーンを顔ぼかし (EgoBlur 適用部) と同じ強いブラーで塗りつぶす
    (rgb: HxWx3、 色空間は不問)。"""
    import cv2
    import numpy as np

    h, w = rgb.shape[:2]
    mask = np.zeros((h, w), np.uint8)
    for zone in zones:
        cv2.fillConvexPoly(mask, zone[1], 255)
    if not mask.any():
        return rgb
    blurred = cv2.blur(rgb, (max(1, h // 2), max(1, w // 2)))
    out = rgb.copy()
    out[mask > 0] = blurred[mask > 0]
    return out


# ─── MCAP 組み立て本体 (= ストリーミング。 フレームをメモリに溜めない) ──


def build_mcap(session_dir: str, out_path: str, blur: bool = True,
               face_detector: str = "egoblur", jpeg_quality: int = 80) -> dict:
    """raw セッションを ROS2 スキーマの納品 MCAP に組み立てる (時系列インターリーブ)。

    blur=True (既定) のとき、 RGB 各フレームに顔ぼかしを適用する。 face_detector で検出器を選ぶ
    ("egoblur" = 既定、 GPU / "mediapipe" = CPU fallback)。 blur=False で完全に無効化。
    """
    import base64

    import cv2
    import numpy as np

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
            if line:
                frames_meta.append(json.loads(line))
    if not frames_meta:
        raise RuntimeError(f"{os.path.basename(frames_path)} is empty")

    def _load_rows(name: str) -> list[dict]:
        path = os.path.join(session_dir, name)
        if not os.path.exists(path):
            return []
        rows = []
        with open(path) as f:
            for line in f:
                line = line.strip()
                if line:
                    rows.append(json.loads(line))
        return rows

    imu_rows = _load_rows("imu.jsonl")
    arkit_rows = _load_rows("arkit_imu.jsonl")          # 全 ARFrame: 姿勢由来の角速度 + tracking
    metrics_rows = _load_rows("device_metrics.jsonl")   # 全 ARFrame: 電池・熱・メモリ

    # 顔ぼかし (= blur=True のときだけ初期化)。 既定は EgoBlur (GPU)。
    face_backend = _make_face_backend(face_detector) if blur else None

    # 撮影禁止マーカーの検出プリパス (CPU)。 顔ぼかしとは独立で、 --no-blur でも必ず適用する
    # (= 店側プライバシーの装置なので落とせない)。 実効 fps は frames.jsonl の実測から。
    dur_s = (int(frames_meta[-1]["timestamp_ns"]) - int(frames_meta[0]["timestamp_ns"])) / 1e9
    eff_fps = (len(frames_meta) - 1) / dur_s if dur_s > 0 else 30.0
    ng_schedule = detect_ng_marker_zones(
        os.path.join(session_dir, "rgb.mp4"),
        corroborate_frames=max(1, int(round(NG_MARKER_CORROBORATE_S * eff_fps))),
    )

    stats = {"rgb": 0, "depth": 0, "confidence": 0, "pose": 0, "imu": 0, "tracking": 0,
             "arkit_imu": 0, "metrics": 0, "point_cloud_msgs": 0, "trajectory": 0,
             "mesh_vertices": 0}

    first_ts = int(frames_meta[0]["timestamp_ns"])
    last_ts = int(frames_meta[-1]["timestamp_ns"])

    # depth.tar の逐次イテレータ (idx 昇順。 同一 idx は depth → confidence の順に並ぶ)
    def _depth_entries():
        tar_path = os.path.join(session_dir, "depth.tar")
        if not os.path.exists(tar_path):
            return
        with tarfile.open(tar_path) as tar:
            for member in tar:
                if not member.isfile() or not member.name.endswith(".png"):
                    continue
                idx = int(os.path.splitext(os.path.basename(member.name))[0])
                kind = "confidence" if member.name.startswith("confidence/") else "depth"
                yield idx, kind, tar.extractfile(member).read()

    def _pc_entries():
        path = os.path.join(session_dir, "pointcloud.jsonl")
        if not os.path.exists(path):
            return
        with open(path) as f:
            for line in f:
                line = line.strip()
                if line:
                    yield json.loads(line)

    with open(out_path, "wb") as out_f:
        out = _McapOut(out_f)
        write = out.write

        # ── 処理来歴 (= どの設定で作った MCAP か) ──
        blur_meta = {"detector": None, "threshold": None, "resize": None}
        if blur:
            blur_meta["detector"] = face_detector
            if face_detector == "egoblur":
                blur_meta["threshold"] = EGOBLUR_SCORE_THRESHOLD
                blur_meta["resize"] = EGOBLUR_RESIZE
            elif face_detector == "mediapipe":
                blur_meta["threshold"] = FACE_BLUR_MIN_CONFIDENCE
        write("/rootlens/processing_info", {"data": json.dumps({
            "pipeline_version": PIPELINE_VERSION,
            "blur": blur,
            "blur_detector": blur_meta["detector"],
            "blur_threshold": blur_meta["threshold"],
            "blur_resize": blur_meta["resize"],
            "jpeg_quality": jpeg_quality,
            "rgb_source": "h264_reencode",
            "ng_marker_dict": NG_MARKER_DICT,
            "ng_marker_zone_frames": len(ng_schedule),
            "source": "rootlens raw session",
            "device_model": meta.get("device_model"),
            "app_version": meta.get("app_version"),
            "axes": "ARKit-native (pose: ARKit world; imu: CoreMotion device axes, m/s^2 incl. gravity)",
        })}, first_ts)

        # ── camera↔IMU 外部パラメータ (収録側 metadata に推定値がある場合のみ) ──
        ext = meta.get("camera_imu_extrinsic")
        if isinstance(ext, dict) and ext.get("rotation_matrix_3x3") is not None:
            rot = ext["rotation_matrix_3x3"]
            if len(rot) == 9 and not isinstance(rot[0], (list, tuple)):
                rot = [rot[0:3], rot[3:6], rot[6:9]]
            trans = ext.get("translation_xyz_m") or [0.0, 0.0, 0.0]
            write("/device/camera_imu_extrinsics", {"transforms": [{
                "header": {"stamp": _stamp(first_ts), "frame_id": "camera_link"},
                "child_frame_id": "imu_frame",
                "transform": {
                    "translation": {"x": float(trans[0]), "y": float(trans[1]), "z": float(trans[2])},
                    "rotation": _rot_to_quat(rot),
                },
            }]}, first_ts)

        # ── IMU 固有値 (収録側 metadata にある場合のみ) ──
        ii = meta.get("imu_intrinsics")
        if isinstance(ii, dict):
            write("/device/imu/intrinsics", {
                "header": {"stamp": _stamp(first_ts), "frame_id": "imu_frame"},
                "accel_noise_density": float(ii.get("accel_noise_density", 0.0)),
                "gyro_noise_density": float(ii.get("gyro_noise_density", 0.0)),
                "accel_bias_random_walk": float(ii.get("accel_bias_random_walk", 0.0)),
                "gyro_bias_random_walk": float(ii.get("gyro_bias_random_walk", 0.0)),
                "accel_bias": {"x": 0.0, "y": 0.0, "z": 0.0},
                "gyro_bias": {"x": 0.0, "y": 0.0, "z": 0.0},
                "sample_rate_hz": int(ii.get("sample_rate_hz", 0)),
                "source": str(ii.get("source", "")),
            }, first_ts)
        if arkit_rows:
            a_first = int(arkit_rows[0]["timestamp_ns"])
            a_last = int(arkit_rows[-1]["timestamp_ns"])
            n = len(arkit_rows)
            arkit_rate = int(round((n - 1) * 1e9 / (a_last - a_first))) if n > 1 and a_last > a_first else 0
            write("/arkit/imu/intrinsics", {
                "header": {"stamp": _stamp(a_first), "frame_id": "camera_link"},
                # VIO 姿勢の差分由来。 加速度は持たないので accel 側は NaN。
                "accel_noise_density": float("nan"),
                "gyro_noise_density": 5.0e-5,
                "accel_bias_random_walk": float("nan"),
                "gyro_bias_random_walk": 1.0e-6,
                "accel_bias": {"x": 0.0, "y": 0.0, "z": 0.0},
                "gyro_bias": {"x": 0.0, "y": 0.0, "z": 0.0},
                "sample_rate_hz": arkit_rate,
                "source": "arkit_vio_derived",
            }, a_first)

        # ── 時系列カーソル群 (フレーム駆動ループが撮影時刻順に消化する) ──
        imu_i = 0
        arkit_i = 0
        metrics_i = 0
        ori_var = float((np.pi / 180.0) ** 2)  # /arkit/imu の姿勢分散 (1 度)^2
        ori_var_diag = [ori_var, 0.0, 0.0, 0.0, ori_var, 0.0, 0.0, 0.0, ori_var]
        no_estimate = [-1.0] + [0.0] * 8  # covariance 先頭 -1 = その量の推定なし

        def _flush_imu(upto_ts: int) -> None:
            nonlocal imu_i
            while imu_i < len(imu_rows) and int(imu_rows[imu_i]["timestamp_ns"]) <= upto_ts:
                row = imu_rows[imu_i]
                imu_i += 1
                ts = int(row["timestamp_ns"])
                acc = row.get("accel", {})
                gyr = row.get("gyro", {})
                att = (row.get("device_motion") or {}).get("attitude") or {}
                if att:
                    orientation = {"x": float(att.get("qx", 0.0)), "y": float(att.get("qy", 0.0)),
                                   "z": float(att.get("qz", 0.0)), "w": float(att.get("qw", 1.0))}
                    ori_cov = [0.0] * 9  # 全ゼロ = covariance 不明 (実測していない値は書かない)
                else:
                    orientation = {"x": 0.0, "y": 0.0, "z": 0.0, "w": 1.0}
                    ori_cov = no_estimate
                write("/device/imu", {
                    "header": {"stamp": _stamp(ts), "frame_id": "imu_frame"},
                    "orientation": orientation,
                    "orientation_covariance": ori_cov,
                    "angular_velocity": {"x": float(gyr.get("x", 0.0)), "y": float(gyr.get("y", 0.0)),
                                         "z": float(gyr.get("z", 0.0))},
                    "angular_velocity_covariance": [0.0] * 9,
                    # 重力込みの比力 (REP 145)。 収録は g 単位なので m/s^2 へ。
                    "linear_acceleration": {"x": float(acc.get("x", 0.0)) * G_TO_MS2,
                                            "y": float(acc.get("y", 0.0)) * G_TO_MS2,
                                            "z": float(acc.get("z", 0.0)) * G_TO_MS2},
                    "linear_acceleration_covariance": [0.0] * 9,
                }, ts)
                stats["imu"] += 1

        def _flush_arkit(upto_ts: int, inclusive: bool) -> None:
            nonlocal arkit_i
            while arkit_i < len(arkit_rows):
                row = arkit_rows[arkit_i]
                ts = int(row["timestamp_ns"])
                if ts > upto_ts or (ts == upto_ts and not inclusive):
                    break
                arkit_i += 1
                write("/arkit/imu", {
                    "header": {"stamp": _stamp(ts), "frame_id": "camera_link"},
                    "orientation": {"x": float(row.get("qx", 0.0)), "y": float(row.get("qy", 0.0)),
                                    "z": float(row.get("qz", 0.0)), "w": float(row.get("qw", 1.0))},
                    "orientation_covariance": ori_var_diag,
                    "angular_velocity": {"x": float(row.get("wx", 0.0)), "y": float(row.get("wy", 0.0)),
                                         "z": float(row.get("wz", 0.0))},
                    "angular_velocity_covariance": [0.0] * 9,
                    "linear_acceleration": {"x": 0.0, "y": 0.0, "z": 0.0},
                    "linear_acceleration_covariance": no_estimate,  # 加速度は持たないストリーム
                }, ts)
                stats["arkit_imu"] += 1
                state = int(row.get("tracking_state", 2))
                write("/camera/tracking_state", {
                    "header": {"stamp": _stamp(ts), "frame_id": "camera_link"},
                    "state": state,
                    "reason": 0,
                    "state_str": TRACKING_STATE_STR.get(state, str(state)),
                    "reason_str": str(row.get("tracking_reason", "")),
                }, ts)
                stats["tracking"] += 1

        def _flush_metrics(upto_ts: int, inclusive: bool) -> None:
            nonlocal metrics_i
            while metrics_i < len(metrics_rows):
                row = metrics_rows[metrics_i]
                ts = int(row["timestamp_ns"])
                if ts > upto_ts or (ts == upto_ts and not inclusive):
                    break
                metrics_i += 1
                write("/device/metrics", {
                    "header": {"stamp": _stamp(ts), "frame_id": "device"},
                    "battery_level": float(row.get("battery_level", -1.0)),
                    "battery_state": int(row.get("battery_state", 0)),
                    "battery_state_str": str(row.get("battery_state_str", "")),
                    "cpu_usage": float(row.get("cpu_usage", 0.0)),
                    "memory_used_mb": float(row.get("memory_used_mb", 0.0)),
                    "memory_available_mb": float(row.get("memory_available_mb", 0.0)),
                    "thermal_state": int(row.get("thermal_state", 0)),
                    "thermal_state_str": str(row.get("thermal_state_str", "")),
                    "device_model": str(row.get("device_model", meta.get("device_model", ""))),
                }, ts)
                stats["metrics"] += 1

        # /trajectory は増分 Path: 書くたびにバッファを空にする
        traj_buf: list[dict] = []
        traj_last_ts: int | None = None

        depth_gen = _depth_entries()
        depth_next = next(depth_gen, None)
        pc_gen = _pc_entries()
        pc_next = next(pc_gen, None)
        depth_info_written = False

        def _write_frame(idx: int, out_rgb) -> None:
            """1 フレーム分のメッセージ群を撮影時刻順の定位置へ書く。"""
            nonlocal depth_next, pc_next, traj_last_ts, depth_info_written
            row = frames_meta[idx]
            ts = int(row["timestamp_ns"])

            # このフレームより過去の補助ストリームを先に流す
            _flush_arkit(ts, inclusive=False)
            _flush_metrics(ts, inclusive=False)

            # camera_info (per-frame。 OIS / AF で内部パラメータは毎フレーム動く)
            k9 = row.get("camera_intrinsics")
            if isinstance(k9, list) and len(k9) == 9:
                fx, cx, fy, cy = float(k9[0]), float(k9[2]), float(k9[4]), float(k9[5])
            else:
                fx, fy, cx, cy = cam["fx"], cam["fy"], cam["cx"], cam["cy"]
            write("/camera/camera_info",
                  _camera_info_msg(ts, cam["width"], cam["height"], fx, fy, cx, cy), ts)

            # pose + tf (+ 5 秒ごとの trajectory)
            t4 = row["camera_transform"]  # row-major 4x4 (ARKit world ← camera)
            pos = {"x": float(t4[0][3]), "y": float(t4[1][3]), "z": float(t4[2][3])}
            quat = _rot_to_quat([r[:3] for r in t4[:3]])
            pose_msg = {"header": {"stamp": _stamp(ts), "frame_id": "world"},
                        "pose": {"position": pos, "orientation": quat}}
            write("/camera/pose", pose_msg, ts)
            stats["pose"] += 1
            write("/tf", {"transforms": [
                {"header": {"stamp": _stamp(ts), "frame_id": "world"},
                 "child_frame_id": "camera_link",
                 "transform": {"translation": pos, "rotation": quat}},
                {"header": {"stamp": _stamp(ts), "frame_id": "camera_link"},
                 "child_frame_id": "camera_optical_frame",
                 # ARKit カメラ軸 (x右, y上, z手前) → 光学フレーム (x右, y下, z前) の X 軸 180° 回転
                 "transform": {"translation": {"x": 0.0, "y": 0.0, "z": 0.0},
                               "rotation": {"x": 1.0, "y": 0.0, "z": 0.0, "w": 0.0}}},
            ]}, ts)
            traj_buf.append(pose_msg)
            if traj_last_ts is None or ts - traj_last_ts >= TRAJECTORY_INTERVAL_NS:
                write("/trajectory", {"header": {"stamp": _stamp(ts), "frame_id": "world"},
                                      "poses": traj_buf}, ts)
                stats["trajectory"] += 1
                traj_buf.clear()
                traj_last_ts = ts

            # point cloud (このフレームの VIO 特徴点スナップショット)
            while pc_next is not None and int(pc_next.get("frame_index", -1)) < idx:
                pc_next = next(pc_gen, None)
            while pc_next is not None and int(pc_next.get("frame_index", -1)) == idx:
                pts = np.frombuffer(base64.b64decode(pc_next["points_b64"]), dtype="<f4").reshape(-1, 3)
                write("/map/point_cloud", _point_cloud2_msg(ts, pts), ts)
                stats["point_cloud_msgs"] += 1
                pc_next = next(pc_gen, None)

            # depth (+ confidence)。 tar 側の欠番はそのまま欠けとして許容する。
            while depth_next is not None and depth_next[0] < idx:
                depth_next = next(depth_gen, None)
            while depth_next is not None and depth_next[0] == idx:
                _, kind, raw = depth_next
                depth_next = next(depth_gen, None)
                img = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_UNCHANGED)
                if img is None:
                    continue
                h, w = img.shape[:2]
                if kind == "depth":
                    if img.dtype != np.uint16:
                        continue
                    write("/camera/depth", {
                        "header": {"stamp": _stamp(ts), "frame_id": "camera_optical_frame"},
                        "height": int(h), "width": int(w),
                        "encoding": "16UC1", "is_bigendian": 0, "step": int(w * 2),
                        "data": np.ascontiguousarray(img).tobytes(),
                    }, ts)
                    stats["depth"] += 1
                    if not depth_info_written and "depth" in cam:
                        d = cam["depth"]
                        write("/camera/depth/camera_info",
                              _camera_info_msg(ts, d["width"], d["height"],
                                               d["fx"], d["fy"], d["cx"], d["cy"]), ts)
                        depth_info_written = True
                else:
                    if img.dtype != np.uint8:
                        continue
                    write("/camera/depth/confidence", {
                        "header": {"stamp": _stamp(ts), "frame_id": "camera_optical_frame"},
                        "height": int(h), "width": int(w),
                        "encoding": "mono8", "is_bigendian": 0, "step": int(w),
                        "data": np.ascontiguousarray(img).tobytes(),
                    }, ts)
                    stats["confidence"] += 1

            # rgb (ぼかし適用済みの RGB → JPEG)
            zones = ng_schedule.get(idx)
            if zones:
                out_rgb = _apply_zone_blur(out_rgb, zones)
            ok_enc, jpg = cv2.imencode(".jpg", cv2.cvtColor(out_rgb, cv2.COLOR_RGB2BGR),
                                       [int(cv2.IMWRITE_JPEG_QUALITY), jpeg_quality])
            if not ok_enc:
                raise RuntimeError(f"jpeg encode failed at frame {idx}")
            write("/camera/rgb/compressed", {
                "header": {"stamp": _stamp(ts), "frame_id": "camera_optical_frame"},
                "format": "jpeg",
                "data": jpg.tobytes(),
            }, ts)
            stats["rgb"] += 1

            # tracking: 全 ARFrame ストリームがあればそちらから (このフレーム自身の分を含める)。
            # 無い旧収録では frames 行 (= 書き込まれたフレームのみ) から。
            if arkit_rows:
                _flush_arkit(ts, inclusive=True)
            else:
                state = int(row.get("tracking_state", 2))
                write("/camera/tracking_state", {
                    "header": {"stamp": _stamp(ts), "frame_id": "camera_link"},
                    "state": state,
                    "reason": 0,
                    "state_str": TRACKING_STATE_STR.get(state, str(state)),
                    "reason_str": str(row.get("tracking_reason", "")),
                }, ts)
                stats["tracking"] += 1

            # IMU はこのフレームまでの分をまとめて (収録側も ARFrame ごとの一括書き)
            _flush_imu(ts)
            _flush_metrics(ts, inclusive=True)

        # ── mp4 デコード → (batch ぼかし) → フレーム駆動書き込み ──
        # RGB フレームのタイムスタンプは jsonl 行とのインデックス 1:1 対応が前提。
        # 範囲外 = 端末側で行と mp4 フレームがずれた不整合データなので、 捏造せず即失敗する。
        batch_size = face_backend.batch_size if face_backend is not None else 1
        cap = cv2.VideoCapture(os.path.join(session_dir, "rgb.mp4"))
        try:
            bgr_batch: list = []
            i_batch: list = []
            i = 0

            def _flush_rgb_batch() -> None:
                if not bgr_batch:
                    return
                if face_backend is not None:
                    rgb_batch = face_backend.blur_batch(bgr_batch)
                else:
                    rgb_batch = [cv2.cvtColor(b, cv2.COLOR_BGR2RGB) for b in bgr_batch]
                for idx, out_rgb in zip(i_batch, rgb_batch):
                    if idx >= len(frames_meta):
                        raise RuntimeError(
                            f"rgb.mp4 has more frames than pose rows in frames.jsonl "
                            f"(frame index {idx} >= {len(frames_meta)} rows); refusing to fabricate timestamps"
                        )
                    _write_frame(idx, out_rgb)

            while True:
                ok, bgr = cap.read()
                if not ok:
                    break
                bgr_batch.append(bgr)
                i_batch.append(i)
                i += 1
                if len(bgr_batch) >= batch_size:
                    _flush_rgb_batch()
                    bgr_batch = []
                    i_batch = []
            _flush_rgb_batch()
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

        # 最終フレーム以降に残った補助ストリーム / IMU を流し切る
        _flush_arkit(1 << 62, inclusive=True)
        _flush_metrics(1 << 62, inclusive=True)
        _flush_imu(1 << 62)

        # ── /map/mesh + /map/mesh_cloud (= 全 ARMeshAnchor を統合した 1 Marker) ──
        mesh_path = os.path.join(session_dir, "mesh.jsonl")
        if os.path.exists(mesh_path):
            all_tri_pts = []
            all_world_verts = []
            with open(mesh_path) as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    row = json.loads(line)
                    verts = np.frombuffer(base64.b64decode(row["vertices_b64"]), dtype="<f4").reshape(-1, 3)
                    faces = np.frombuffer(base64.b64decode(row["faces_b64"]), dtype="<u4").reshape(-1, 3)
                    t4 = np.asarray(row["transform"], dtype=np.float64)  # row-major 4x4 (anchor → world)
                    world = (verts @ t4[:3, :3].T + t4[:3, 3]).astype("<f4")
                    all_world_verts.append(world)
                    all_tri_pts.append(world[faces.reshape(-1)])  # TRIANGLE_LIST 展開
            if all_tri_pts:
                tri = np.concatenate(all_tri_pts, axis=0)
                write("/map/mesh", {
                    "header": {"stamp": _stamp(last_ts), "frame_id": "world"},
                    "ns": "",
                    "id": 0,
                    "type": 11,   # TRIANGLE_LIST
                    "action": 0,  # ADD
                    "pose": {"position": {"x": 0.0, "y": 0.0, "z": 0.0},
                             "orientation": {"x": 0.0, "y": 0.0, "z": 0.0, "w": 1.0}},
                    "scale": {"x": 1.0, "y": 1.0, "z": 1.0},
                    "color": {"r": 1.0, "g": 1.0, "b": 1.0, "a": 1.0},
                    "lifetime": {"sec": 0, "nanosec": 0},
                    "frame_locked": False,
                    "points": [{"x": float(p[0]), "y": float(p[1]), "z": float(p[2])} for p in tri],
                    "colors": [],
                    "text": "",
                    "mesh_resource": "",
                    "mesh_use_embedded_materials": False,
                }, last_ts)
                merged = np.concatenate(all_world_verts, axis=0)
                write("/map/mesh_cloud", _point_cloud2_msg(last_ts, merged), last_ts)
                stats["mesh_vertices"] = int(merged.shape[0])

        # ── metadata.json 全体を dot-flatten で Metadata record に同梱 ──
        out.add_metadata("session_metadata", _flatten_metadata(meta))

        out.finish()

    detections_total = face_backend.detections_total if face_backend is not None else 0
    return {
        "stats": stats,
        "blur": blur,
        "faceDetector": face_detector if blur else None,
        "detectionsTotal": detections_total,
        "ngMarkerZoneFrames": len(ng_schedule),
        "durationMs": int((time.time() - t0) * 1000),
        "outputBytes": os.path.getsize(out_path),
        "jsonlFrames": len(frames_meta),
    }


# ─── R2 入出力 (= 決定論的キーへの上書きで冪等) ────────────────────────

SESSION_FILES = ["rgb.mp4", "frames.jsonl", "realtime_handpose.jsonl", "imu.jsonl", "metadata.json", "depth.tar", "pointcloud.jsonl", "mesh.jsonl", "arkit_imu.jsonl", "device_metrics.jsonl"]


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


def _clip_db_row(content_hash: str) -> dict:
    """clips に accounts (現場属性) を join して引く。 未登録クリップ
    (= POST /api/clips を通っていないアップロード) と、 accounts に行が無い
    アカウント (= テスト端末など納品対象外) はどちらも fail-loud。"""
    import psycopg2

    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    try:
        with conn.cursor() as cur:
            cur.execute(
                "select c.account_id, c.duration_ms, c.recorded_at, a.domain, a.site"
                " from clips c left join accounts a on a.id = c.account_id"
                " where c.content_hash = %s",
                (content_hash,),
            )
            row = cur.fetchone()
    finally:
        conn.close()
    if not row:
        raise RuntimeError(f"clip not registered in DB: {content_hash}")
    account_id, duration_ms, recorded_at, domain, site = row
    if domain is None:
        raise RuntimeError(
            f"account {account_id} has no accounts row; "
            f"insert (id, domain, site) before delivering its clips")
    return {"account_id": str(account_id), "duration_ms": duration_ms,
            "recorded_at": recorded_at, "domain": domain, "site": site}


_QT_EPOCH = dt.datetime(1904, 1, 1, tzinfo=dt.timezone.utc)


def _mp4_creation_time(path: str) -> dt.datetime | None:
    """QuickTime ヘッダ (mvhd) の creation_time = 録画開始の壁時計 (UTC)。
    AVAssetWriter は moov をファイル末尾に書くので末尾 16MB から探す。
    mdat のバイト列がたまたま 'mvhd' に一致した誤検出は年代の妥当性 (2020-2035) で捨てる。"""
    import struct

    size = os.path.getsize(path)
    with open(path, "rb") as fh:
        fh.seek(max(0, size - 16_000_000))
        buf = fh.read()
        i = buf.rfind(b"mvhd")
        if i < 0:
            # 一部の録画は moov が先頭側にある (中断復旧などで書き直された個体)。
            fh.seek(0)
            buf = fh.read(16_000_000)
            i = buf.rfind(b"mvhd")
    if i < 0:
        return None
    version = buf[i + 4]
    if version == 0:
        secs = struct.unpack(">I", buf[i + 8:i + 12])[0]
    else:
        secs = struct.unpack(">Q", buf[i + 8:i + 16])[0]
    ts = _QT_EPOCH + dt.timedelta(seconds=secs)
    return ts if 2020 <= ts.year <= 2035 else None


def _set_clip_recorded_at(content_hash: str, recorded_at: dt.datetime) -> None:
    import psycopg2

    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    try:
        with conn.cursor() as cur:
            cur.execute(
                "update clips set recorded_at = %s"
                " where content_hash = %s and recorded_at is null",
                (recorded_at, content_hash),
            )
        conn.commit()
    finally:
        conn.close()


def regenerate_manifest(s3, bucket: str, bucket_raw: str) -> int:
    """manifest.jsonl を DB + R2 の実状態からまるごと作り直す。 行の材料:
    <hash>/session.mcap の一覧 (サイズ) + clips テーブル (domain / 尺 / 登録時刻)
    + raw metadata.json (fps / 解像度 / 端末)。 raw や DB 行が欠けたセッションも
    行自体は残して欠損フィールドを null にする (集計を止めない)。
    スキーマを変えるときは README-for-fpv.md の表と gen_manifest.py を同時に更新する。"""
    import psycopg2

    sessions: dict[str, int] = {}
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket):
        for obj in page.get("Contents") or []:
            key = obj["Key"]
            if key.endswith("/session.mcap") and key.count("/") == 1:
                sessions[key.split("/")[0]] = obj["Size"]

    rows: dict[str, dict] = {}
    if sessions:
        conn = psycopg2.connect(os.environ["DATABASE_URL"])
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "select c.content_hash, c.duration_ms, c.created_at, c.recorded_at,"
                    " a.domain, a.site"
                    " from clips c left join accounts a on a.id = c.account_id"
                    " where c.content_hash = any(%s)",
                    (list(sessions),),
                )
                rows = {h: {"duration_ms": d, "created_at": c, "recorded_at": r,
                            "domain": dom, "site": site}
                        for h, d, c, r, dom, site in cur.fetchall()}
        finally:
            conn.close()

    entries = []
    for h, mcap_bytes in sessions.items():
        db_row = rows.get(h)
        try:
            body = s3.get_object(Bucket=bucket_raw, Key=f"raw/{h}/metadata.json")["Body"].read()
            meta = json.loads(body)
        except Exception:
            meta = {}
        camera = meta.get("camera") or {}
        settings = meta.get("capture_settings") or {}
        uploaded = db_row["created_at"] if db_row else None
        # recordedAt の正は clips.recorded_at (= rgb.mp4 の mvhd 由来)。 mvhd が読めなかった
        # 行だけ「アップロード時刻 − 尺」で録画開始を近似する。
        recorded = db_row["recorded_at"] if db_row else None
        if recorded is not None:
            recorded = recorded.isoformat()
        elif uploaded is not None:
            recorded = (uploaded - dt.timedelta(
                milliseconds=(db_row["duration_ms"] or 0))).isoformat()
        entries.append({
            "contentHash": h,
            "domain": db_row["domain"] if db_row else None,
            "site": db_row["site"] if db_row else None,
            "recordedAt": recorded,
            "uploadedAt": uploaded.isoformat() if uploaded else None,
            "durationSec": round((db_row["duration_ms"] or 0) / 1000.0, 3) if db_row else None,
            "fps": settings.get("recording_rate_hz"),
            "resolution": (f"{camera.get('width')}x{camera.get('height')}"
                           if camera.get("width") else None),
            "device": meta.get("device_model"),
            "osVersion": meta.get("os_version"),
            # 本番バケットには blur なしを置けない (process_session のガードで保証)。
            "blurred": True,
            "mcapBytes": mcap_bytes,
        })
    entries.sort(key=lambda e: (e.get("recordedAt") or "", e["contentHash"]))
    lines = "".join(json.dumps(e, ensure_ascii=False, separators=(",", ":")) + "\n"
                    for e in entries)
    s3.put_object(Bucket=bucket, Key="manifest.jsonl", Body=lines.encode("utf-8"),
                  ContentType="application/x-ndjson")
    return len(entries)


def process_session(content_hash: str, blur: bool = True,
                    face_detector: str = "egoblur", jpeg_quality: int = 80,
                    target_bucket: str | None = None) -> dict:
    """raw/<hash>/ を取得 → build_mcap → <target_bucket>/<hash>/session.mcap に上書き。

    blur=False で顔ぼかしを無効化 (= raw の生映像そのまま)。
    target_bucket が None のときは環境変数 R2_BUCKET_FPVLABS (既定 rootlens-fpvlabs = 本番) を使う。
    検証時は本番以外の書ける R2 バケットを指定すること。"""
    s3 = _r2_client()
    bucket_raw = os.environ.get("R2_BUCKET_RAW_ARKIT", "rootlens-raw-arkit")
    bucket_out = target_bucket or os.environ.get("R2_BUCKET_FPVLABS", "rootlens-fpvlabs")

    # 本番の納品バケットにはぼかし無しを置かない (= manifest の blurred: true を構造的に保証)。
    if not blur and bucket_out == os.environ.get("R2_BUCKET_FPVLABS", "rootlens-fpvlabs"):
        raise RuntimeError("refusing --no-blur into the production delivery bucket; use --target-bucket")

    # DB 照合とドメイン解決は GPU を回す前に済ませる (未登録 / 属性未設定で即死させる)。
    db_row = _clip_db_row(content_hash)

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

        # 録画開始時刻が未記録なら、 落としてきた rgb.mp4 の mvhd から読んで DB に埋める
        # (= manifest の recordedAt の源泉。 追加ダウンロードなしで手に入る)。
        if db_row["recorded_at"] is None:
            rec = _mp4_creation_time(os.path.join(session_dir, "rgb.mp4"))
            if rec is not None:
                _set_clip_recorded_at(content_hash, rec)

        out_path = os.path.join(tmp, "session.mcap")
        result = build_mcap(session_dir, out_path, blur=blur,
                            face_detector=face_detector, jpeg_quality=jpeg_quality)

        out_key = f"{content_hash}/session.mcap"
        s3.upload_file(out_path, bucket_out, out_key, ExtraArgs={"ContentType": "application/octet-stream"})
        result["outputKey"] = f"{bucket_out}/{out_key}"

        # manifest を DB + R2 の実状態から再生成 (方式は冒頭の manifest セクションのコメント参照)。
        result["manifestEntries"] = regenerate_manifest(s3, bucket_out, bucket_raw)
        result["domain"] = db_row["domain"]
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
            "psycopg2-binary",  # clips テーブル照合 (ドメイン解決) 用
            "mcap", "mcap-ros2-support",
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
        secrets=[
            modal.Secret.from_name("r2-creds"),
            modal.Secret.from_name("supabase-db"),  # DATABASE_URL (clips 照合用)
        ],
    )
    def fpvlabs_process(content_hash: str, blur: bool = True,
                        face_detector: str = "egoblur", jpeg_quality: int = 80,
                        target_bucket: str = "") -> dict:
        return process_session(content_hash, blur=blur,
                               face_detector=face_detector, jpeg_quality=jpeg_quality,
                               target_bucket=target_bucket or None)

    @app.local_entrypoint()
    def main(content_hash: str, blur: bool = True,
             face_detector: str = "egoblur", jpeg_quality: int = 80,
             target_bucket: str = ""):
        # ぼかし切替:   --blur (既定) / --no-blur
        # 検出器切替:   --face-detector egoblur (既定) / mediapipe (CPU fallback)
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

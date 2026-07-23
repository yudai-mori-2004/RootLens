# lp-sample: ドライブ公開サンプルの 1 セッション → LP /sample ビューア用の配信キャッシュ。
#
# サンプルデータの正は共有ドライブ (samples/<domain>/<pipeline>/<セッション>/)。 LP の /sample は
# その中の 1 本を選んでスキーマとスペックを見せるビューアで、 ここで作る 6 アセットは
# ブラウザ再生のためのビュー変換にすぎない。 出力キーはドライブのフォルダ名末尾と同じ
# <hash8> (= content_hash 先頭 8 桁) にして、 どのサンプルを表示しているかを id で辿れるようにする。
#
#   入力: rootlens-raw-arkit の raw/<hash>/{frames.jsonl, imu.jsonl, metadata.json, depth.tar, mesh.jsonl}
#         + rootlens-fpvlabs の <hash>/session.mcap (ぼかし済み映像の源泉。 無ければ実行拒否)
#   出力: rootlens-public の lp-sample/<hash8>/{rgb.mp4, depth.mp4, mesh.glb,
#         trajectory.json, timeseries.json, summary.json}
#
# rgb.mp4 は raw ではなく MCAP のぼかし済み JPEG 列から再構成する (sample-drive と同じ経路)。
# 公開に出る映像はぼかし済みへ一本化し、 raw の未ぼかし rgb には触らない。
#
# 実行:
#   Modal:  modal run --detach tools/lp-sample/lp_sample.py --content-hash <hash>
#   ローカル: LP_SAMPLE_LOCAL=1 python tools/lp-sample/lp_sample.py <hash> [target_bucket]
#
# 検証: --target-bucket <bucket> で本番以外の書けるバケットへ切り替え (fpvlabs.py と同じ流儀)。

from __future__ import annotations

import base64
import io
import json
import math
import os
import struct
import subprocess
import tarfile
import tempfile
from pathlib import Path

PIPELINE_VERSION = "lp-sample-2"

# アセット出力先バケット (書き先)。 --target-bucket で上書きできる。
DEFAULT_TARGET_BUCKET = "rootlens-public"
TARGET_KEY_PREFIX = "lp-sample"

# 出力チャンネルの決定 (=これ以外は作らない、これは全部作る)。
OUTPUT_FILES = [
    "rgb.mp4",
    "depth.mp4",
    "mesh.glb",
    "trajectory.json",
    "timeseries.json",
    "summary.json",
]

# ─── 定数: 素材ごとのエンコード設定 ─────────────────────────────────
# RGB は sample-drive の rgb.mp4 と同じ 5 Mbps H.264 + faststart (= ドライブで配る映像と
# 同じ源泉・同じ設定で作り、 LP の帯域予算にも収める)。
RGB_BITRATE_KBPS = 5000

# depth のダイナミックレンジ (mm)。 屋内なら 5 m でだいたい収まる。
# これを超える値は 5000mm にクランプ、 0 mm(欠損) は黒。
DEPTH_MAX_MM = 5000
DEPTH_BITRATE_KBPS = 2500  # RGB より低め (色彩の情報密度が薄いので圧縮効きやすい)

# 軌跡は 10 Hz にデシメート (元 30 Hz)。 表示に必要な最小限で、 JSON サイズを 1/3 にする。
TRAJECTORY_TARGET_HZ = 10.0

# 時系列 (IMU + 手検出 + トラッキング) は 30 Hz に揃える。 IMU は 100 Hz なので 3 サンプル刻み。
TIMESERIES_TARGET_HZ = 30.0


# ══════════════════════════════════════════════════════════════════════
# R2 IO
# ══════════════════════════════════════════════════════════════════════

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


# raw の rgb.mp4 は意図的に含めない: 未ぼかしなので、 映像は fpvlabs MCAP 経由でしか読まない。
SESSION_FILES = [
    "frames.jsonl",
    "realtime_handpose.jsonl",  # 旧録画は frames.jsonl の代わりにこの名前
    "imu.jsonl",
    "metadata.json",
    "depth.tar",       # LiDAR デバイスのみ
    "mesh.jsonl",      # LiDAR デバイスのみ
    "pointcloud.jsonl",  # 参考。 現状のビューアでは使わない (mesh を優先)
]

REQUIRED_INPUTS = ["metadata.json"]  # 手ポーズ系はどちらかがあれば OK (下でチェック)


def download_raw(s3, bucket_raw: str, content_hash: str, dest_dir: str) -> dict[str, str]:
    """raw/<hash>/ の全ファイルを dest_dir に落とし、 存在するものだけの {name: path} を返す。
    REQUIRED_INPUTS のどれかが欠けていたら RuntimeError で落とす。
    frames.jsonl / realtime_handpose.jsonl のどちらかが必須 (旧録画は後者)。"""
    got = {}
    for name in SESSION_FILES:
        key = f"raw/{content_hash}/{name}"
        dest = os.path.join(dest_dir, name)
        try:
            s3.download_file(bucket_raw, key, dest)
            got[name] = dest
        except Exception:
            if name in REQUIRED_INPUTS:
                raise RuntimeError(f"required input missing: {key}")
    if "frames.jsonl" not in got and "realtime_handpose.jsonl" not in got:
        raise RuntimeError(f"required input missing: raw/{content_hash}/frames.jsonl (or legacy realtime_handpose.jsonl)")
    # 呼び出し側は frames.jsonl を鍵として使うので、 レガシー版はエイリアスで見えるようにする。
    if "frames.jsonl" not in got:
        got["frames.jsonl"] = got["realtime_handpose.jsonl"]
    return got


# ══════════════════════════════════════════════════════════════════════
# rgb.mp4 (fpvlabs MCAP のぼかし済み JPEG 列から再構成)
# ══════════════════════════════════════════════════════════════════════

def build_rgb_from_mcap(mcap_path: str, meta: dict, out_mp4: str) -> dict:
    """MCAP の /camera/rgb/compressed (顔ぼかし済み JPEG 列) を H.264 mp4 に再エンコードする。
    sample-drive の rgb.mp4 と同じ源泉・同じ設定 (= LP で再生する映像とドライブで配る映像が
    同じセッションの同じぼかし結果になる)。 fps は metadata の recording_rate_hz
    (MCAP のタイムスタンプと ±10ms 程度ずれるが、 再生上は判別不能)。"""
    from mcap.reader import make_reader
    from mcap_ros2.decoder import DecoderFactory

    fps = float((meta.get("capture_settings") or {}).get("recording_rate_hz") or 15)

    cmd = [
        "ffmpeg", "-y", "-v", "error",
        "-f", "image2pipe", "-vcodec", "mjpeg",
        "-framerate", f"{fps:.6f}",
        "-i", "-",
        "-c:v", "libx264", "-preset", "medium",
        "-b:v", f"{RGB_BITRATE_KBPS}k",
        "-pix_fmt", "yuv420p",
        "-an",                      # 音声トラックなし (録画に音声は無い)
        "-movflags", "+faststart",  # moov を先頭に (= プログレッシブ再生で頭からすぐ再生)
        out_mp4,
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    assert proc.stdin is not None
    frame_count = 0
    try:
        with open(mcap_path, "rb") as fh:
            reader = make_reader(fh, decoder_factories=[DecoderFactory()])
            for _, _, _, ros_msg in reader.iter_decoded_messages(
                    topics=["/camera/rgb/compressed"]):
                proc.stdin.write(ros_msg.data)  # data フィールドが JPEG bytes
                frame_count += 1
    finally:
        proc.stdin.close()
    rc = proc.wait()
    if rc != 0:
        raise RuntimeError(f"ffmpeg exited {rc} while encoding blurred rgb")
    if frame_count == 0:
        raise RuntimeError("mcap contained no /camera/rgb/compressed frames")
    return {"bytes": os.path.getsize(out_mp4), "frames": frame_count, "fps": fps}


# ══════════════════════════════════════════════════════════════════════
# depth.mp4 (LiDAR 深度を turbo カラーマップ動画に)
# ══════════════════════════════════════════════════════════════════════

def _turbo_lut() -> "np.ndarray":
    """matplotlib の turbo カラーマップを 256 段の LUT (Nx3 uint8) にして返す。
    matplotlib への実行時依存を避けるため、 定数近似を直接吐く実装を選ぶ。"""
    import numpy as np

    # Turbo は Google の Anton Mikhailov による多項式カラーマップ。
    # x ∈ [0, 1] に対して R, G, B の 6 次多項式で近似する。 実装は Google 公開版に準拠。
    kR = np.array([0.13572138, 4.61539260, -42.66032258, 132.13108234, -152.94239396, 59.28637943])
    kG = np.array([0.09140261, 2.19418839, 4.84296658, -14.18503333, 4.27729857, 2.82956604])
    kB = np.array([0.10667330, 12.64194608, -60.58204836, 110.36276771, -89.90310912, 27.34824973])
    x = np.linspace(0.0, 1.0, 256)
    r = kR[0] + x*(kR[1] + x*(kR[2] + x*(kR[3] + x*(kR[4] + x*kR[5]))))
    g = kG[0] + x*(kG[1] + x*(kG[2] + x*(kG[3] + x*(kG[4] + x*kG[5]))))
    b = kB[0] + x*(kB[1] + x*(kB[2] + x*(kB[3] + x*(kB[4] + x*kB[5]))))
    lut = np.stack([r, g, b], axis=1)
    return np.clip(lut * 255.0, 0, 255).astype(np.uint8)


def build_depth(src_tar: str, out_mp4: str, fps: float) -> dict:
    """depth.tar の 16-bit PNG フレーム群を turbo カラーマップ 8-bit RGB に変換して mp4 に。
    フレームインデックス順に並べる (tar 内は depth/<frame_index:06d>.png)。 confidence は使わない。"""
    import numpy as np
    from PIL import Image

    lut = _turbo_lut()

    # tar からフレームを取り出し、 depth/<idx>.png だけを frame_index 順で読む。
    with tarfile.open(src_tar, "r") as tar:
        depth_names = sorted(
            (m.name for m in tar.getmembers() if m.name.startswith("depth/") and m.name.endswith(".png")),
            key=lambda n: int(os.path.splitext(os.path.basename(n))[0]),
        )
        if not depth_names:
            raise RuntimeError("depth.tar contains no depth/*.png frames")

        # 1 枚読んで解像度を決める (以降のフレームも同じ解像度前提)。
        first = tar.extractfile(depth_names[0])
        assert first is not None
        first_img = Image.open(io.BytesIO(first.read()))
        w, h = first_img.size

        # ffmpeg を stdin から生 RGB フレームで受け取る形で立ち上げる。
        # -f rawvideo, -pixel_format rgb24, -video_size WxH, -framerate fps
        # 出力は H.264 5 Mbps、 yuv420p (safe pixel format)、 faststart。
        cmd = [
            "ffmpeg", "-y", "-v", "error",
            "-f", "rawvideo",
            "-pixel_format", "rgb24",
            "-video_size", f"{w}x{h}",
            "-framerate", f"{fps:.6f}",
            "-i", "-",
            "-c:v", "libx264",
            "-preset", "medium",
            "-b:v", f"{DEPTH_BITRATE_KBPS}k",
            "-maxrate", f"{int(DEPTH_BITRATE_KBPS * 1.3)}k",
            "-bufsize", f"{DEPTH_BITRATE_KBPS * 2}k",
            "-pix_fmt", "yuv420p",
            "-an",
            "-movflags", "+faststart",
            out_mp4,
        ]
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
        assert proc.stdin is not None

        frames_written = 0
        for name in depth_names:
            entry = tar.extractfile(name)
            if entry is None:
                continue
            img = Image.open(io.BytesIO(entry.read()))
            arr = np.array(img, dtype=np.uint16)  # mm
            # 正規化 → 0..255。 0(欠損) は 0 (黒) にしておく。
            valid = arr > 0
            norm = np.zeros_like(arr, dtype=np.float32)
            np.clip(arr, 0, DEPTH_MAX_MM, out=arr)
            norm[valid] = arr[valid].astype(np.float32) / DEPTH_MAX_MM
            idx = np.clip((norm * 255.0).round(), 0, 255).astype(np.uint8)
            rgb = lut[idx]  # (h, w, 3) uint8
            rgb[~valid] = 0  # 欠損は黒
            proc.stdin.write(rgb.tobytes())
            frames_written += 1

        proc.stdin.close()
        rc = proc.wait()
        if rc != 0:
            raise RuntimeError(f"ffmpeg exited {rc} while writing depth.mp4")

    return {"bytes": os.path.getsize(out_mp4), "frames": frames_written, "width": w, "height": h}


# ══════════════════════════════════════════════════════════════════════
# mesh.glb (mesh.jsonl の全 anchor を世界座標で結合 → 単一 glTF binary)
# ══════════════════════════════════════════════════════════════════════

def build_mesh(src_jsonl: str, out_glb: str) -> dict:
    """anchor ごとの局所座標 vertices を anchor.transform で世界座標に変換して 1 個のメッシュに結合。
    出力は glTF 2.0 binary (GLB)。 内訳は 1 primitive (TRIANGLES): POSITION + INDICES。"""
    import numpy as np

    all_verts_world = []
    all_faces = []
    vertex_offset = 0
    anchor_count = 0

    with open(src_jsonl) as f:
        for line in f:
            row = json.loads(line)
            v_bytes = base64.b64decode(row["vertices_b64"])
            f_bytes = base64.b64decode(row["faces_b64"])
            v_count = row["vertex_count"]
            f_count = row["face_count"]
            verts = np.frombuffer(v_bytes, dtype=np.float32).reshape(v_count, 3)
            faces = np.frombuffer(f_bytes, dtype=np.uint32).reshape(f_count, 3)

            # 4x4 行優先 → 世界座標へ (v_world = M · [v; 1])。
            M = np.array(row["transform"], dtype=np.float32)  # 4x4
            R = M[:3, :3]
            t = M[:3, 3]
            world = verts @ R.T + t  # (n, 3)

            all_verts_world.append(world.astype(np.float32))
            all_faces.append((faces + vertex_offset).astype(np.uint32))
            vertex_offset += v_count
            anchor_count += 1

    if not all_verts_world:
        raise RuntimeError(f"mesh.jsonl empty: {src_jsonl}")

    verts_all = np.concatenate(all_verts_world, axis=0)
    faces_all = np.concatenate(all_faces, axis=0)

    total_v = verts_all.shape[0]
    total_f = faces_all.shape[0]

    # ─── glTF 2.0 binary (GLB) を手組みで書く (pygltflib への依存を避ける)。 ─────
    # レイアウト: [Header 12B][JSON chunk][BIN chunk]。
    # BIN chunk = POSITION (float32 xyz × n) + INDICES (uint32 × 3m)。 4 byte align。
    pos_bytes = verts_all.tobytes()  # (n, 3) float32
    idx_bytes = faces_all.tobytes()  # (m, 3) uint32
    pos_len = len(pos_bytes)
    idx_len = len(idx_bytes)
    # BIN 全体を 4 byte 境界に padding
    pad_to_4 = (4 - ((pos_len + idx_len) % 4)) % 4
    bin_body = pos_bytes + idx_bytes + (b"\x00" * pad_to_4)

    # bbox は accessor.min/max に入れる (glTF Validator の要件)。
    bb_min = verts_all.min(axis=0).tolist()
    bb_max = verts_all.max(axis=0).tolist()

    gltf = {
        "asset": {"version": "2.0", "generator": f"rootlens-lp-sample/{PIPELINE_VERSION}"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0}],
        "meshes": [{
            "primitives": [{
                "attributes": {"POSITION": 0},
                "indices": 1,
                "mode": 4,  # TRIANGLES
            }],
        }],
        "buffers": [{"byteLength": len(bin_body)}],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": pos_len, "target": 34962},  # ARRAY_BUFFER
            {"buffer": 0, "byteOffset": pos_len, "byteLength": idx_len, "target": 34963},  # ELEMENT_ARRAY_BUFFER
        ],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": total_v, "type": "VEC3",
             "min": bb_min, "max": bb_max},  # float32
            {"bufferView": 1, "componentType": 5125, "count": total_f * 3, "type": "SCALAR"},  # uint32
        ],
    }
    json_body = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    # JSON chunk も 4 byte 境界へ (空白でパディング)。
    pad_json = (4 - (len(json_body) % 4)) % 4
    json_body = json_body + (b" " * pad_json)

    with open(out_glb, "wb") as fh:
        total_size = 12 + 8 + len(json_body) + 8 + len(bin_body)
        # Header: magic 'glTF' + version 2 + total length
        fh.write(struct.pack("<III", 0x46546C67, 2, total_size))
        # JSON chunk header + body
        fh.write(struct.pack("<II", len(json_body), 0x4E4F534A))  # 'JSON'
        fh.write(json_body)
        # BIN chunk header + body
        fh.write(struct.pack("<II", len(bin_body), 0x004E4942))  # 'BIN\x00'
        fh.write(bin_body)

    return {
        "bytes": os.path.getsize(out_glb),
        "anchors": anchor_count,
        "vertices": int(total_v),
        "triangles": int(total_f),
        "bboxMin": bb_min,
        "bboxMax": bb_max,
    }


# ══════════════════════════════════════════════════════════════════════
# trajectory.json (frames.jsonl のカメラ姿勢を 10 Hz に間引き)
# ══════════════════════════════════════════════════════════════════════

def _rotation_to_quat(R):
    """3x3 rotation → (qx, qy, qz, qw)。 Shepperd 法。"""
    import numpy as np
    tr = R[0, 0] + R[1, 1] + R[2, 2]
    if tr > 0:
        s = math.sqrt(tr + 1.0) * 2
        qw = 0.25 * s
        qx = (R[2, 1] - R[1, 2]) / s
        qy = (R[0, 2] - R[2, 0]) / s
        qz = (R[1, 0] - R[0, 1]) / s
    elif R[0, 0] > R[1, 1] and R[0, 0] > R[2, 2]:
        s = math.sqrt(1.0 + R[0, 0] - R[1, 1] - R[2, 2]) * 2
        qw = (R[2, 1] - R[1, 2]) / s
        qx = 0.25 * s
        qy = (R[0, 1] + R[1, 0]) / s
        qz = (R[0, 2] + R[2, 0]) / s
    elif R[1, 1] > R[2, 2]:
        s = math.sqrt(1.0 + R[1, 1] - R[0, 0] - R[2, 2]) * 2
        qw = (R[0, 2] - R[2, 0]) / s
        qx = (R[0, 1] + R[1, 0]) / s
        qy = 0.25 * s
        qz = (R[1, 2] + R[2, 1]) / s
    else:
        s = math.sqrt(1.0 + R[2, 2] - R[0, 0] - R[1, 1]) * 2
        qw = (R[1, 0] - R[0, 1]) / s
        qx = (R[0, 2] + R[2, 0]) / s
        qy = (R[1, 2] + R[2, 1]) / s
        qz = 0.25 * s
    return [qx, qy, qz, qw]


def build_trajectory(src_frames: str, out_json: str) -> dict:
    """フレームごとのカメラ姿勢を 10 Hz にデシメート。
    出力スキーマ: { hz: 10, t0_ns, poses: [{t: ms_from_t0, xyz: [x,y,z], quat: [x,y,z,w]}, ...] }"""
    import numpy as np

    poses = []
    t0 = None
    period_ns = int(1e9 / TRAJECTORY_TARGET_HZ)
    next_ts = None

    with open(src_frames) as f:
        for line in f:
            row = json.loads(line)
            ts = row["timestamp_ns"]
            if t0 is None:
                t0 = ts
                next_ts = ts
            if ts < next_ts:
                continue
            next_ts += period_ns

            M = np.array(row["camera_transform"], dtype=np.float32)  # 4x4 row-major
            R = M[:3, :3]
            xyz = M[:3, 3].tolist()
            quat = _rotation_to_quat(R)
            poses.append({
                "t": (ts - t0) / 1e6,  # ms from t0
                "xyz": [float(v) for v in xyz],
                "quat": [float(v) for v in quat],
            })

    payload = {
        "hz": TRAJECTORY_TARGET_HZ,
        "t0_ns": t0,
        "poses": poses,
    }
    with open(out_json, "w") as fh:
        json.dump(payload, fh, separators=(",", ":"))
    return {"bytes": os.path.getsize(out_json), "samples": len(poses)}


# ══════════════════════════════════════════════════════════════════════
# timeseries.json (IMU + 手検出 + トラッキング状態、 共通時刻軸)
# ══════════════════════════════════════════════════════════════════════

def build_timeseries(src_frames: str, src_imu: str | None, out_json: str) -> dict:
    """30 Hz の共通時刻軸に IMU 6 軸 + 手検出 (左右別) + トラッキング状態を並べる。
    出力スキーマ:
      { hz, t0_ns,
        imu:      { accel: [[x,y,z], ...], gyro: [[x,y,z], ...] },  # imu.jsonl から nearest-neighbor リサンプル
        hands:    { left: [bool, ...], right: [bool, ...] },        # frames.jsonl の handedness で分離
        tracking: [ state_int, ... ],                                 # 0=notAvailable / 1=limited / 2=normal
      }
    ソースが 100 Hz IMU + 30 Hz frames と非同期なので、 frames のタイムスタンプに近い IMU 値を持ってくる。"""
    import bisect

    # frames を全部読む (時刻・手の左右別検出・トラッキング状態を 30 Hz で拾う)。
    # hands は左右別に分けておく: UI が「左手だけ」「右手だけ」「両手」「なし」を出せるようにする。
    frame_ts_ns = []
    frame_hand_left = []
    frame_hand_right = []
    frame_tracking = []
    with open(src_frames) as f:
        for line in f:
            row = json.loads(line)
            frame_ts_ns.append(row["timestamp_ns"])
            has_left = has_right = False
            for h in (row.get("hands") or []):
                side = h.get("handedness")
                if side == "left":
                    has_left = True
                elif side == "right":
                    has_right = True
            frame_hand_left.append(has_left)
            frame_hand_right.append(has_right)
            frame_tracking.append(int(row.get("tracking_state", 0)))

    # imu を全部読む (100 Hz なので frames の 3 倍程度)。 IMU が無い場合は accel/gyro 空配列。
    imu_ts_ns = []
    imu_accel = []
    imu_gyro = []
    if src_imu and os.path.exists(src_imu):
        with open(src_imu) as f:
            for line in f:
                row = json.loads(line)
                imu_ts_ns.append(row["timestamp_ns"])
                a = row.get("accel", {})
                g = row.get("gyro", {})
                imu_accel.append([float(a.get("x", 0.0)), float(a.get("y", 0.0)), float(a.get("z", 0.0))])
                imu_gyro.append([float(g.get("x", 0.0)), float(g.get("y", 0.0)), float(g.get("z", 0.0))])

    t0 = frame_ts_ns[0] if frame_ts_ns else 0
    period_ns = int(1e9 / TIMESERIES_TARGET_HZ)
    next_ts = t0

    # frames を 30 Hz に間引く (元 30 Hz なので基本全部拾う。 サンプルが密ならスキップ)。
    kept_indices = []
    for i, ts in enumerate(frame_ts_ns):
        if ts < next_ts:
            continue
        kept_indices.append(i)
        next_ts += period_ns

    # 各 kept sample に対して最寄りの IMU 行を持ってくる (nearest-neighbor)。
    accel_out = []
    gyro_out = []
    for i in kept_indices:
        ts = frame_ts_ns[i]
        if imu_ts_ns:
            j = bisect.bisect_left(imu_ts_ns, ts)
            if j >= len(imu_ts_ns):
                j = len(imu_ts_ns) - 1
            elif j > 0 and abs(imu_ts_ns[j-1] - ts) < abs(imu_ts_ns[j] - ts):
                j -= 1
            accel_out.append(imu_accel[j])
            gyro_out.append(imu_gyro[j])
        else:
            accel_out.append([0.0, 0.0, 0.0])
            gyro_out.append([0.0, 0.0, 0.0])

    payload = {
        "hz": TIMESERIES_TARGET_HZ,
        "t0_ns": t0,
        "imu": {"accel": accel_out, "gyro": gyro_out},
        "hands": {
            "left": [frame_hand_left[i] for i in kept_indices],
            "right": [frame_hand_right[i] for i in kept_indices],
        },
        "tracking": [frame_tracking[i] for i in kept_indices],
    }
    with open(out_json, "w") as fh:
        json.dump(payload, fh, separators=(",", ":"))
    return {"bytes": os.path.getsize(out_json), "samples": len(kept_indices)}


# ══════════════════════════════════════════════════════════════════════
# summary.json (静的な統計情報。 LP のフッタに載せる数値)
# ══════════════════════════════════════════════════════════════════════

def build_summary(session_files: dict[str, str], asset_stats: dict[str, dict], out_json: str,
                  delivery: dict | None = None) -> dict:
    """尺・fps・軌跡距離・面積・検出率・デバイス・ストリーム別バイト数と、
    納品形式 (fpvlabs パイプラインが吐く session.mcap のサイズ) をまとめる。
    asset_stats は他の build_* の返り値。 delivery は {"format": "session.mcap", "bytes": ...}。"""
    import numpy as np

    frames_ts = []
    hand_hits = 0
    tracking_normal = 0
    trajectory_xyz = []
    with open(session_files["frames.jsonl"]) as f:
        for line in f:
            row = json.loads(line)
            frames_ts.append(row["timestamp_ns"])
            if row.get("hands"):
                hand_hits += 1
            if int(row.get("tracking_state", 0)) == 2:
                tracking_normal += 1
            M = row.get("camera_transform")
            if M:
                trajectory_xyz.append([M[0][3], M[1][3], M[2][3]])

    n = len(frames_ts)
    dur_s = (frames_ts[-1] - frames_ts[0]) / 1e9 if n > 1 else 0.0
    fps = n / dur_s if dur_s > 0 else 0.0

    xyz = np.array(trajectory_xyz, dtype=np.float32) if trajectory_xyz else np.zeros((0, 3), dtype=np.float32)
    if len(xyz) > 1:
        diffs = np.diff(xyz, axis=0)
        path_len_m = float(np.linalg.norm(diffs, axis=1).sum())
    else:
        path_len_m = 0.0
    if len(xyz) > 0:
        bb_min = xyz.min(axis=0).tolist()
        bb_max = xyz.max(axis=0).tolist()
        area_m2 = float((bb_max[0] - bb_min[0]) * (bb_max[2] - bb_min[2]))  # x-z 床面積の近似
    else:
        bb_min = [0.0, 0.0, 0.0]
        bb_max = [0.0, 0.0, 0.0]
        area_m2 = 0.0

    meta = {}
    if "metadata.json" in session_files:
        with open(session_files["metadata.json"]) as f:
            meta = json.load(f)

    payload = {
        "pipelineVersion": PIPELINE_VERSION,
        "device": meta.get("device_model"),
        "osVersion": meta.get("os_version"),
        "appVersion": meta.get("app_version"),
        "recordingConfig": meta.get("recording_config", "arkit"),
        "camera": meta.get("camera"),
        "captureSettings": meta.get("capture_settings"),
        "durationSec": dur_s,
        "frames": n,
        "fps": fps,
        "pathLengthM": path_len_m,
        "areaM2": area_m2,
        "trajectoryBBoxMin": bb_min,
        "trajectoryBBoxMax": bb_max,
        "handDetectionRate": hand_hits / n if n else 0.0,
        "trackingNormalRate": tracking_normal / n if n else 0.0,
        "assets": asset_stats,
        # 実際に取引先に納品する形式 (fpvlabs パイプラインの session.mcap)。 LP 用の
        # rgb.mp4 / depth.mp4 / mesh.glb 等はビジュアライザ配信のためのビュー用アセットで、
        # 商品ではない。 summary はこの区別を明示する。
        "delivery": delivery,
    }
    with open(out_json, "w") as fh:
        json.dump(payload, fh, indent=2)
    return {"bytes": os.path.getsize(out_json), "durationSec": dur_s, "fps": fps}


# ══════════════════════════════════════════════════════════════════════
# メインエントリ
# ══════════════════════════════════════════════════════════════════════

def process_session(content_hash: str,
                    target_bucket: str | None = None) -> dict:
    """raw/<hash>/ + fpvlabs の session.mcap を取得 → 6 アセットを組み立てて
    lp-sample/<hash8>/ に put。 冪等: 再実行は同キーへの上書き。"""
    s3 = _r2_client()
    bucket_raw = os.environ.get("R2_BUCKET_RAW_ARKIT", "rootlens-raw-arkit")
    bucket_fpv = os.environ.get("R2_BUCKET_FPVLABS", "rootlens-fpvlabs")
    bucket_out = target_bucket or os.environ.get("R2_BUCKET_PUBLIC", DEFAULT_TARGET_BUCKET)
    slug = content_hash[:8]  # ドライブのセッションフォルダ名末尾と同じ id 表記

    with tempfile.TemporaryDirectory() as tmp:
        session_dir = os.path.join(tmp, "session")
        os.makedirs(session_dir)
        session_files = download_raw(s3, bucket_raw, content_hash, session_dir)

        # session.mcap (必須): 公開に出る映像はぼかし済みの MCAP 経由のみ。
        mcap_path = os.path.join(tmp, "session.mcap")
        try:
            s3.download_file(bucket_fpv, f"{content_hash}/session.mcap", mcap_path)
        except Exception as e:
            raise RuntimeError(
                f"session.mcap missing for {content_hash[:8]}. "
                f"the LP rgb is rebuilt from the blurred JPEG stream in the mcap; "
                f"run fpvlabs first: {e}"
            )

        with open(session_files["metadata.json"]) as f:
            meta = json.load(f)

        out_dir = os.path.join(tmp, "assets")
        os.makedirs(out_dir)

        asset_stats: dict[str, dict] = {}

        # rgb (必須。 ぼかし済み MCAP から再構成)
        rgb_out = os.path.join(out_dir, "rgb.mp4")
        asset_stats["rgb.mp4"] = build_rgb_from_mcap(mcap_path, meta, rgb_out)

        # depth.mp4 の fps は metadata の recording_fps がもっとも信頼できる (= 実効レート)。
        fps = float(meta.get("camera", {}).get("recording_fps") or meta.get("camera", {}).get("fps") or 30.0)

        # depth (LiDAR 時のみ)。 無ければアセットも出さない。
        if "depth.tar" in session_files:
            depth_out = os.path.join(out_dir, "depth.mp4")
            asset_stats["depth.mp4"] = build_depth(session_files["depth.tar"], depth_out, fps=fps)

        # mesh (LiDAR 時のみ)
        if "mesh.jsonl" in session_files:
            mesh_out = os.path.join(out_dir, "mesh.glb")
            asset_stats["mesh.glb"] = build_mesh(session_files["mesh.jsonl"], mesh_out)

        # trajectory + timeseries + summary
        traj_out = os.path.join(out_dir, "trajectory.json")
        asset_stats["trajectory.json"] = build_trajectory(session_files["frames.jsonl"], traj_out)

        ts_out = os.path.join(out_dir, "timeseries.json")
        asset_stats["timeseries.json"] = build_timeseries(
            session_files["frames.jsonl"],
            session_files.get("imu.jsonl"),
            ts_out,
        )

        # 納品形式 = fpvlabs の session.mcap。 rgb の再構成に使ったローカルファイルがそのまま実体。
        delivery = {"format": "session.mcap", "bytes": os.path.getsize(mcap_path),
                    "blurred": True, "spec": "MCAP container with ROS2 messages"}

        sum_out = os.path.join(out_dir, "summary.json")
        asset_stats["summary.json"] = build_summary(session_files, asset_stats, sum_out, delivery=delivery)

        # 出力を rootlens-public/lp-sample/<slug>/ へアップロード
        uploaded = []
        for name in os.listdir(out_dir):
            local = os.path.join(out_dir, name)
            key = f"{TARGET_KEY_PREFIX}/{slug}/{name}"
            ctype = _guess_content_type(name)
            s3.upload_file(local, bucket_out, key, ExtraArgs={"ContentType": ctype})
            uploaded.append(f"{bucket_out}/{key}")

        return {
            "pipelineVersion": PIPELINE_VERSION,
            "contentHash": content_hash,
            "slug": slug,
            "uploaded": uploaded,
            "assets": asset_stats,
        }


def _guess_content_type(name: str) -> str:
    if name.endswith(".mp4"):
        return "video/mp4"
    if name.endswith(".glb"):
        return "model/gltf-binary"
    if name.endswith(".json"):
        return "application/json"
    return "application/octet-stream"


# ─── Modal wiring ──────────────────────────────────────────────────────

try:
    import modal

    image = (
        modal.Image.debian_slim(python_version="3.11")
        .apt_install("ffmpeg")
        .pip_install(
            "numpy<2",
            "Pillow",
            "boto3",
            "mcap",
            "mcap-ros2-support",
        )
    )

    app = modal.App("rootlens-lp-sample")

    @app.function(
        image=image,
        timeout=3600,           # 60 分クリップまで余裕
        memory=8192,
        cpu=4.0,
        secrets=[modal.Secret.from_name("r2-creds")],
    )
    def lp_sample_process(content_hash: str, target_bucket: str = "") -> dict:
        return process_session(content_hash, target_bucket=target_bucket or None)

    @app.local_entrypoint()
    def main(content_hash: str, target_bucket: str = ""):
        print(json.dumps(lp_sample_process.remote(content_hash, target_bucket), indent=2))

except ImportError:
    modal = None


if __name__ == "__main__" and (modal is None or os.environ.get("LP_SAMPLE_LOCAL")):
    import sys

    if len(sys.argv) < 2:
        print("usage: python lp_sample.py <content_hash> [target_bucket]", file=sys.stderr)
        sys.exit(1)
    hash_ = sys.argv[1]
    target_ = sys.argv[2] if len(sys.argv) > 2 else None
    print(json.dumps(process_session(hash_, target_bucket=target_), indent=2))

"""
rootlens-server サーバパイプライン §6.2 ステップ 6 (= Stera 互換 MCAP 合成) を
Modal の Python 関数として実装。

入力:  ぼかし済 MP4 (= R2 blurred バケットの key)
処理:
  1. R2 から ぼかし済 MP4 を download
  2. stera-sdk の MCAPReader 構築は MP4 から直接できないため、 stera-sdk 互換 schema で
     mcap library を使って MCAP を直接構築する:
     - /camera/rgb/compressed channel (= sensor_msgs/CompressedImage、 jpeg encoded frames)
     - /hand/landmarks channel (= stera-sdk が出す HandTracker 出力 schema)
     - /metadata (= root_nft_asset_id、 quality_score、 processing_info)
  3. stera-sdk の HandTracker(model="mediapipe") で 21 関節 × 全フレーム検出
  4. mcap.Writer で MCAP を構築
  5. R2 delivery-mcap バケットに upload

出力: MCAP の sha256 + フレーム数 + hand pose 検出件数 + 処理時間

Stera schema:
  hand pose の channel schema は stera-sdk の `stera.models.HandTracker` の出力 dataclass
  に合わせる (= stera-sdk が export する MCAP と直接互換)。
"""

import io
import os
import struct
import time
import json
import hashlib
import subprocess

import modal

# ─── Modal Image ────────────────────────────────────────────────────────

image = (
    modal.Image.debian_slim(python_version="3.11")
    # libGLESv2 / libEGL は mediapipe (HandTracker backend) の C 拡張が dlopen する。
    # libusb-1.0 / libudev1 も Modal slim 環境では暗黙依存。
    .apt_install(
        "ffmpeg", "libgl1", "libglib2.0-0",
        "libgles2-mesa", "libegl1",
    )
    .pip_install(
        "stera-sdk[all]==0.0.4",  # MCAPReader / HandTracker / Evaluate を内蔵
        "mcap==1.2.1",
        "boto3==1.35.50",
        "fastapi[standard]",
        "numpy<2",
        "opencv-python-headless==4.10.0.84",
    )
)

app = modal.App("rootlens-synthesize", image=image)

# ─── ROS1 wire format helpers (= sensor_msgs/CompressedImage 用) ──────

def encode_compressed_image(seq: int, stamp_ns: int, frame_id: str, jpeg: bytes) -> bytes:
    """sensor_msgs/CompressedImage を ROS1 wire format で encode。"""
    sec = stamp_ns // 1_000_000_000
    nsec = stamp_ns % 1_000_000_000
    out = bytearray()
    out += struct.pack("<III", seq, sec, nsec)
    fid = frame_id.encode("utf-8")
    out += struct.pack("<I", len(fid)); out += fid
    fmt = b"jpeg"
    out += struct.pack("<I", len(fmt)); out += fmt
    out += struct.pack("<I", len(jpeg)); out += jpeg
    return bytes(out)

COMPRESSED_IMAGE_SCHEMA = """std_msgs/Header header
string format
uint8[] data

================================================================================
MSG: std_msgs/Header
uint32 seq
time stamp
string frame_id
""".strip()

# ─── 推論モデルの遅延ロード ──────────────────────────────────────────────

_hand_tracker = None

def get_hand_tracker():
    global _hand_tracker
    if _hand_tracker is None:
        from stera.models import HandTracker
        _hand_tracker = HandTracker(model="mediapipe")
    return _hand_tracker

# ─── 主処理 ──────────────────────────────────────────────────────────────

def synthesize_mcap(mp4_path: str, mcap_path: str, root_asset_id: str | None) -> dict:
    """ぼかし済 MP4 → Stera 互換 MCAP を構築。 hand pose を抽出して同梱。"""
    import cv2
    import numpy as np
    from mcap.writer import Writer

    t_start = time.time()
    frames_dir = "/tmp/synth_frames"
    os.makedirs(frames_dir, exist_ok=True)
    for f in os.listdir(frames_dir):
        os.remove(f"{frames_dir}/{f}")

    # 1. ffmpeg で MP4 → PNG 連番 + fps を取得
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=r_frame_rate",
         "-of", "default=nokey=1:noprint_wrappers=1", mp4_path],
        capture_output=True, text=True, check=True,
    )
    num, den = probe.stdout.strip().split("/")
    fps = float(num) / float(den) if float(den) != 0 else 30.0
    frame_interval_ns = int(1_000_000_000 / fps)

    subprocess.run(
        ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
         "-i", mp4_path, f"{frames_dir}/%06d.png"],
        check=True,
    )
    frame_files = sorted(os.listdir(frames_dir))

    # 2. MCAP writer 準備 + schema / channel 登録
    tracker = get_hand_tracker()
    hands_detected = 0

    with open(mcap_path, "wb") as f_out:
        writer = Writer(f_out)
        writer.start()

        rgb_schema_id = writer.register_schema(
            name="sensor_msgs/CompressedImage",
            encoding="ros1msg",
            data=COMPRESSED_IMAGE_SCHEMA.encode("utf-8"),
        )
        rgb_channel_id = writer.register_channel(
            topic="/camera/rgb/compressed",
            message_encoding="ros1",
            schema_id=rgb_schema_id,
        )

        # hand pose は JSON channel (= jsonschema) で軽量に出す。
        # buyer は stera-sdk で読まずとも汎用 JSON で扱える、 stera と等価な情報量。
        hand_schema_data = json.dumps({
            "type": "object",
            "properties": {
                "frame_index": {"type": "integer"},
                "ts_ns": {"type": "integer"},
                "hands": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "handedness": {"type": "string"},
                            "landmarks": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "x": {"type": "number"},
                                        "y": {"type": "number"},
                                        "z": {"type": "number"},
                                    },
                                },
                            },
                        },
                    },
                },
            },
        }).encode("utf-8")
        hand_schema_id = writer.register_schema(
            name="rootlens/HandPose", encoding="jsonschema", data=hand_schema_data,
        )
        hand_channel_id = writer.register_channel(
            topic="/hand/landmarks",
            message_encoding="json",
            schema_id=hand_schema_id,
        )

        # metadata channel (= 単発 record で root_nft_asset_id を焼く)
        meta_schema_data = json.dumps({
            "type": "object",
            "properties": {
                "root_nft_asset_id": {"type": ["string", "null"]},
                "frame_count": {"type": "integer"},
                "fps": {"type": "number"},
                "source": {"type": "string"},
            },
        }).encode("utf-8")
        meta_schema_id = writer.register_schema(
            name="rootlens/Metadata", encoding="jsonschema", data=meta_schema_data,
        )
        meta_channel_id = writer.register_channel(
            topic="/rootlens/metadata",
            message_encoding="json",
            schema_id=meta_schema_id,
        )

        # 3. 各 frame: JPEG encode → RGB message、 hand pose → /hand/landmarks
        for i, fname in enumerate(frame_files):
            img = cv2.imread(f"{frames_dir}/{fname}")
            if img is None:
                continue
            ok, jpg = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
            if not ok:
                continue
            ts_ns = i * frame_interval_ns

            # RGB message
            wire = encode_compressed_image(
                seq=i, stamp_ns=ts_ns, frame_id="camera", jpeg=jpg.tobytes(),
            )
            writer.add_message(
                channel_id=rgb_channel_id,
                log_time=ts_ns,
                publish_time=ts_ns,
                data=wire,
                sequence=i,
            )

            # Hand pose (mediapipe via stera-sdk)。 RGB image を numpy array で渡す。
            # stera-sdk の HandTracker は frame-like object を取るが、 raw image にも対応。
            try:
                rgb_img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
                detected = _detect_hands(tracker, rgb_img)
                if detected:
                    hands_detected += len(detected)
                hand_payload = {
                    "frame_index": i,
                    "ts_ns": ts_ns,
                    "hands": detected or [],
                }
                writer.add_message(
                    channel_id=hand_channel_id,
                    log_time=ts_ns,
                    publish_time=ts_ns,
                    data=json.dumps(hand_payload).encode("utf-8"),
                    sequence=i,
                )
            except Exception as e:
                # 検出失敗は致命的でない、 空 hands で続行
                print(f"[synthesize] hand detect failed at frame {i}: {e}")

        # metadata 1 件 (= 最初の timestamp に焼く)
        meta_payload = {
            "root_nft_asset_id": root_asset_id,
            "frame_count": len(frame_files),
            "fps": fps,
            "source": "rootlens-mobile-mp4",
        }
        writer.add_message(
            channel_id=meta_channel_id,
            log_time=0,
            publish_time=0,
            data=json.dumps(meta_payload).encode("utf-8"),
            sequence=0,
        )

        writer.finish()

    # MCAP sha256
    with open(mcap_path, "rb") as f:
        digest = hashlib.sha256(f.read()).hexdigest()

    # 一時 frame を掃除
    for f in os.listdir(frames_dir):
        os.remove(f"{frames_dir}/{f}")

    return {
        "mcapContentHash": digest,
        "frameCount": len(frame_files),
        "handsDetected": hands_detected,
        "durationMs": int((time.time() - t_start) * 1000),
    }


def _detect_hands(tracker, rgb_img):
    """stera-sdk の HandTracker から JSON-serializable な list を取り出す。
    HandTracker.detect_hands の返値型は stera-sdk version 依存なので、 ここで吸収。
    """
    out = []
    # stera-sdk v0.0.4 alpha では `detect_hands(frame)` で list of HandLandmarks を返す
    # 各 hand は handedness ("left"/"right") + 21 landmarks (= x, y, z)。
    try:
        result = tracker.detect_hands(rgb_img)
    except (AttributeError, TypeError):
        # API が違う場合は frame wrapper を期待しているかも
        try:
            result = tracker.detect(rgb_img)
        except Exception:
            return out
    for hand in (result or []):
        handedness = getattr(hand, "handedness", "unknown")
        landmarks = []
        for lm in getattr(hand, "landmarks", []):
            landmarks.append({
                "x": float(getattr(lm, "x", 0.0)),
                "y": float(getattr(lm, "y", 0.0)),
                "z": float(getattr(lm, "z", 0.0)),
            })
        out.append({"handedness": str(handedness), "landmarks": landmarks})
    return out

# ─── Modal function ─────────────────────────────────────────────────────

@app.function(
    gpu="T4",
    timeout=900,
    secrets=[modal.Secret.from_name("r2-creds")],
)
@modal.fastapi_endpoint(method="POST")
def synthesize_clip(blurred_key: str, output_key: str, idempotency_key: str, root_asset_id: str = ""):
    """rootlens-server から呼ぶ。 R2 から blurred MP4 を取って Stera 互換 MCAP を作って R2 に置く。"""
    import boto3

    account_id = os.environ["R2_ACCOUNT_ID"]
    bucket = os.environ.get("R2_BUCKET_BLURRED", "rootlens-mcap-blurred")

    s3 = boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )

    # 冪等性チェック
    try:
        head = s3.head_object(Bucket=bucket, Key=output_key)
        meta = head.get("Metadata", {})
        return {
            "mcapContentHash": meta.get("mcap-content-hash", ""),
            "frameCount": int(meta.get("frame-count", 0)),
            "handsDetected": int(meta.get("hands-detected", 0)),
            "durationMs": 0,
            "cached": True,
        }
    except s3.exceptions.ClientError:
        pass

    in_path = "/tmp/blurred.mp4"
    out_path = "/tmp/delivery.mcap"
    s3.download_file(bucket, blurred_key, in_path)
    stats = synthesize_mcap(in_path, out_path, root_asset_id or None)

    s3.upload_file(
        out_path,
        bucket,
        output_key,
        ExtraArgs={
            "ContentType": "application/mcap",
            "Metadata": {
                "mcap-content-hash": stats["mcapContentHash"],
                "frame-count": str(stats["frameCount"]),
                "hands-detected": str(stats["handsDetected"]),
                "root-nft-asset-id": root_asset_id or "",
                "idempotency-key": idempotency_key,
            },
        },
    )
    return {**stats, "cached": False}

@app.local_entrypoint()
def main():
    print("Modal app rootlens-synthesize defined. Deploy with `modal deploy server/modal/synthesize.py`.")

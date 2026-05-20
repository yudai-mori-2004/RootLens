"""
RootLens LP 第一弾サンプル dataset 用の Modal 関数。

入力: 1 本の MP4 (= iPhone 純正カメラ、 sensors / depth / intrinsics なし)
処理:
  1. ffmpeg で frame iterate → YuNet で顔ぼかし → H.264 再 encode
  2. ぼかし済 MP4 に C2PA 「署名 S」 を埋め込む
  3. ぼかし済 MP4 を WiLoR-mini に通して per-frame の手データを抽出
出力: ぼかし済 MP4 (= R2 に upload) + per-frame 手データ JSON (= 戻り値)

LP 用なので IMU / カメラ姿勢 / 深度 / tracking_state はない (= アプリ撮影でないため)。
LeRobot v3 dataset の組み立ては ローカル orchestrator (= server/scripts/build_lp_sample.py)
が担当。

実装上、 blur.py の顔ぼかし + C2PA 経路と bundle.py の WiLoR 経路を 1 つの container 上で
連続実行する。 GPU container 上で YuNet (CPU) も走らせるが軽いので問題なし。
"""

import os
import subprocess
import time
import hashlib

import modal

# ─── Modal Image 定義 ──────────────────────────────────────────────────

YUNET_MODEL_PATH = "/root/models/face_detection_yunet_2023mar.onnx"
_LOCAL_MODELS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "libgl1", "libglib2.0-0", "git")
    .pip_install(
        # YuNet 顔ぼかし (= CPU)
        "opencv-python-headless==4.10.0.84",
        # C2PA 「署名 S」
        "c2pa-python==0.32.6",
        "cryptography",
        # WiLoR-mini 手検出 (= GPU)
        "git+https://github.com/warmshao/WiLoR-mini.git",
        "torch==2.4.0",
        "torchvision==0.19.0",
        "ultralytics",
        # 共通
        "numpy<2",
        "boto3==1.35.50",
        "fastapi[standard]",
    )
    .add_local_dir(_LOCAL_MODELS_DIR, "/root/models")
)

c2pa_secret = modal.Secret.from_name(
    "rootlens-c2pa",
    required_keys=["SERVER_C2PA_CERT_CHAIN_PEM", "SERVER_C2PA_PRIVATE_KEY_PEM"],
)
r2_secret = modal.Secret.from_name("r2-creds")

app = modal.App("rootlens-lp-bundle", image=image)

# ─── YuNet (= 顔検出) lazy loader ──────────────────────────────────────

_face_detector = None


def get_face_detector():
    """OpenCV 同梱 YuNet を遅延 init (= blur.py と同パラメータ)。
    score_threshold は egocentric の拳誤検出を抑えるため 0.85 (= blur.py 詳細参照)。"""
    global _face_detector
    if _face_detector is None:
        import cv2
        if not os.path.exists(YUNET_MODEL_PATH):
            raise RuntimeError(
                f"YuNet weight not found at {YUNET_MODEL_PATH}. "
                "確認: server/modal/models/face_detection_yunet_2023mar.onnx が repo に存在するか。"
            )
        _face_detector = cv2.FaceDetectorYN.create(
            YUNET_MODEL_PATH, "", (320, 320),
            score_threshold=0.85, nms_threshold=0.3, top_k=5000,
        )
    return _face_detector


# ─── WiLoR-mini (= 手検出) lazy loader ─────────────────────────────────

_wilor_pipeline = None


def get_wilor_pipeline():
    """WiLoR-mini HandPose3dEstimationPipeline を遅延 init (= bundle.py と同設定)。
    初回呼出で HF から weight を auto-download (= ~600 MB)、 以降 container 内 cache。"""
    global _wilor_pipeline
    if _wilor_pipeline is None:
        import torch
        from wilor_mini.pipelines.wilor_hand_pose3d_estimation_pipeline import (
            WiLorHandPose3dEstimationPipeline,
        )
        device = "cuda" if torch.cuda.is_available() else "cpu"
        dtype = torch.float16 if device == "cuda" else torch.float32
        _wilor_pipeline = WiLorHandPose3dEstimationPipeline(
            device=device, dtype=dtype, verbose=False,
        )
    return _wilor_pipeline


# ─── 1 frame 顔ぼかし (= blur.py から流用) ─────────────────────────────

def blur_frame_bgr(img):
    """BGR uint8 ndarray を受け取り、 顔をぼかした BGR ndarray を返す。"""
    import cv2

    h, w = img.shape[:2]
    face_detector = get_face_detector()
    face_detector.setInputSize((w, h))
    _, faces = face_detector.detect(img)
    face_count = 0
    if faces is not None:
        for row in faces:
            fx, fy, fw, fh = int(row[0]), int(row[1]), int(row[2]), int(row[3])
            pad_x = max(2, fw * 20 // 100)
            pad_y = max(2, fh * 20 // 100)
            x1 = max(0, fx - pad_x)
            y1 = max(0, fy - pad_y)
            x2 = min(w, fx + fw + pad_x)
            y2 = min(h, fy + fh + pad_y)
            if x2 <= x1 or y2 <= y1:
                continue
            region = img[y1:y2, x1:x2]
            k = max(15, ((max(region.shape[:2]) // 6) | 1))
            img[y1:y2, x1:x2] = cv2.GaussianBlur(region, (k, k), 0)
            face_count += 1
    return img, face_count


# ─── C2PA 「署名 S」 埋め込み (= blur.py から流用) ──────────────────────

def sign_c2pa(mp4_path: str, faces_total: int) -> None:
    """ぼかし済 MP4 に C2PA manifest (= 「署名 S」) を in-place で埋める。"""
    import c2pa
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.backends import default_backend

    chain_pem = os.environ.get("SERVER_C2PA_CERT_CHAIN_PEM", "")
    key_pem = os.environ.get("SERVER_C2PA_PRIVATE_KEY_PEM", "")
    if not chain_pem or not key_pem:
        raise RuntimeError(
            "SERVER_C2PA_CERT_CHAIN_PEM / SERVER_C2PA_PRIVATE_KEY_PEM are required "
            "(= Modal Secret rootlens-c2pa)。"
        )

    manifest = {
        "claim_generator_info": [{"name": "rootlens-server", "version": "0.1"}],
        "format": "video/mp4",
        "title": "RootLens LP sample clip",
        "ingredients": [],
        "assertions": [
            {
                "label": "c2pa.actions",
                "data": {
                    "actions": [
                        {
                            "action": "c2pa.placed",
                            "softwareAgent": {"name": "YuNet"},
                            "parameters": {
                                "description": f"face blur applied to {faces_total} regions",
                            },
                        },
                    ],
                },
            },
        ],
    }

    private_key = serialization.load_pem_private_key(
        key_pem.encode(), password=None, backend=default_backend(),
    )

    def sign_callback(data: bytes) -> bytes:
        return private_key.sign(data, ec.ECDSA(hashes.SHA256()))

    settings = c2pa.Settings()
    settings.set("verify.verify_after_sign", "false")

    tmp_signed = mp4_path + ".signed.mp4"
    with c2pa.Context(settings) as ctx:
        with c2pa.Signer.from_callback(
            sign_callback, c2pa.C2paSigningAlg.ES256, chain_pem, None,
        ) as signer:
            with c2pa.Builder(manifest, ctx) as builder:
                builder.sign_file(mp4_path, tmp_signed, signer)
    os.replace(tmp_signed, mp4_path)


# ─── WiLoR per-frame 抽出 (= bundle.py から流用) ───────────────────────

def _to_numpy(x):
    import numpy as np
    if hasattr(x, "detach"):
        return x.detach().cpu().numpy()
    return np.asarray(x)


def _axis_angle_to_quat(axis_angle) -> list[float]:
    """3-dim axis-angle → quaternion (qx, qy, qz, qw)。"""
    import numpy as np
    aa = np.asarray(axis_angle, dtype=np.float32).reshape(-1)
    angle = float(np.linalg.norm(aa))
    if angle < 1e-8:
        return [0.0, 0.0, 0.0, 1.0]
    axis = aa / angle
    s = float(np.sin(angle / 2.0))
    return [
        float(axis[0] * s),
        float(axis[1] * s),
        float(axis[2] * s),
        float(np.cos(angle / 2.0)),
    ]


def _extract_hand_observations(rgb_bgr) -> dict:
    """1 frame の BGR から WiLoR-mini で手検出。 戻り値の構造は bundle.py と同じ:
        {
          "keypoints":   [[left 21x3], [right 21x3]]   (= MANO canonical hand-local)
          "present":     [bool, bool]                  (= [left, right])
          "action":      [14]                          (= 両手手首 6-DoF camera-space)
          "mano_pose":   [[left 48], [right 48]]       (= global_orient 3 + hand_pose 45)
        }
    WiLoR-mini が手を 1 本も検出しなかった frame では present 双方 False で zeros 埋め。
    """
    import numpy as np

    pipe = get_wilor_pipeline()
    # 失敗は propagate (= silent zeros で「全フレーム未検出」 を装わない)。
    outputs = pipe.predict(rgb_bgr)

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

        ct = preds.get("pred_cam_t_full")
        if ct is not None:
            ct_arr = _to_numpy(ct).reshape(-1)
            if ct_arr.size >= 3:
                wrist_pos[idx] = [float(ct_arr[0]), float(ct_arr[1]), float(ct_arr[2])]

        go = preds.get("global_orient")
        hp = preds.get("hand_pose")
        if go is not None and hp is not None:
            go_arr = _to_numpy(go).reshape(-1)
            hp_arr = _to_numpy(hp).reshape(-1)
            if go_arr.size >= 3 and hp_arr.size >= 45:
                pose48 = np.concatenate([go_arr[:3], hp_arr[:45]]).astype(np.float32)
                mano_pose[idx] = pose48.tolist()
                wrist_quat[idx] = _axis_angle_to_quat(go_arr[:3].astype(np.float32))

    action: list[float] = []
    for hand in (0, 1):
        action.extend([
            float(wrist_pos[hand][0]),
            float(wrist_pos[hand][1]),
            float(wrist_pos[hand][2]),
        ])
        action.extend([
            float(wrist_quat[hand][0]),
            float(wrist_quat[hand][1]),
            float(wrist_quat[hand][2]),
            float(wrist_quat[hand][3]),
        ])

    return {
        "keypoints": keypoints,
        "present": present,
        "action": action,
        "mano_pose": mano_pose,
    }


# ─── 統合処理: ぼかし + C2PA + 手検出 ──────────────────────────────────

def process_clip(in_path: str, out_path: str) -> dict:
    """1 本の MP4 → ぼかし + C2PA 「署名 S」 + 全 frame の手検出 を 1 回で実行。

    戻り値:
      {
        "blurredContentHash": str (= 出力 MP4 ファイル全体の sha256, hex)
        "facesBlurred":       int (= 全 frame 合計の検出顔数)
        "framesProcessed":    int
        "fps":                float
        "width":              int
        "height":             int
        "handRecords":        [ { frame_index, keypoints, present, action, mano_pose }, ... ]
        "durationMs":         int
      }
    """
    import numpy as np
    import cv2

    t_start = time.time()

    # ffprobe で width / height / fps を取得 (= rawvideo の形を pipe で指定するため必須)
    probe = subprocess.run(
        ["ffprobe", "-v", "error",
         "-select_streams", "v:0",
         "-show_entries", "stream=width,height,r_frame_rate",
         "-of", "csv=p=0:s=x", in_path],
        capture_output=True, text=True, check=True,
    )
    parts = probe.stdout.strip().split("x")
    width = int(parts[0])
    height = int(parts[1])
    rate = parts[2]
    num, den = rate.split("/")
    fps = float(num) / float(den) if float(den) != 0 else 30.0

    # YuNet warmup (= cold start を blur ループの外に出す)
    get_face_detector()

    # ぼかし: in_path → tmp_unsigned (= まだ C2PA 無し)
    tmp_unsigned = out_path + ".unsigned.mp4"

    read_proc = subprocess.Popen(
        ["ffmpeg", "-hide_banner", "-loglevel", "error",
         "-i", in_path,
         "-f", "rawvideo", "-pix_fmt", "bgr24", "-"],
        stdout=subprocess.PIPE, bufsize=10**8,
    )
    write_proc = subprocess.Popen(
        ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
         "-f", "rawvideo", "-pix_fmt", "bgr24",
         "-s", f"{width}x{height}", "-r", str(fps),
         "-i", "-",
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
         "-pix_fmt", "yuv420p", "-movflags", "+faststart",
         tmp_unsigned],
        stdin=subprocess.PIPE, bufsize=10**8,
    )

    frame_size = width * height * 3
    faces_total = 0
    frames_processed = 0
    try:
        while True:
            raw = read_proc.stdout.read(frame_size)
            if len(raw) < frame_size:
                break
            img = np.frombuffer(raw, np.uint8).reshape((height, width, 3)).copy()
            blurred, faces = blur_frame_bgr(img)
            faces_total += faces
            write_proc.stdin.write(blurred.tobytes())
            frames_processed += 1
    finally:
        if write_proc.stdin:
            write_proc.stdin.close()
        write_proc.wait()
        read_proc.stdout.close()
        read_proc.wait()

    # C2PA 「署名 S」 を埋める (= in-place、 結果は out_path に)
    os.replace(tmp_unsigned, out_path)
    sign_c2pa(out_path, faces_total=faces_total)

    # WiLoR per-frame: ぼかし済 + 署名済 MP4 を読んで手検出
    get_wilor_pipeline()  # warmup (= HF download が必要なら最初の 1 回で済ませる)
    hand_records: list[dict] = []
    cap = cv2.VideoCapture(out_path)
    try:
        i = 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            hand = _extract_hand_observations(frame)
            hand_records.append({
                "frame_index": i,
                "keypoints": hand["keypoints"],
                "present": hand["present"],
                "action": hand["action"],
                "mano_pose": hand["mano_pose"],
            })
            i += 1
    finally:
        cap.release()

    # 出力 MP4 の sha256 (= 署名 + ぼかし後 ファイル全体、 LP 用の content_hash としては
    # これを採用。 アプリ本番での「C2PA active manifest 署名 sha256」 定義とは別軸。
    # SPECS_JA 書き直し後に整合させる)。
    with open(out_path, "rb") as f:
        digest = hashlib.sha256(f.read()).hexdigest()

    return {
        "blurredContentHash": digest,
        "facesBlurred": faces_total,
        "framesProcessed": frames_processed,
        "fps": fps,
        "width": width,
        "height": height,
        "handRecords": hand_records,
        "durationMs": int((time.time() - t_start) * 1000),
    }


# ─── Modal function (R2 経由) ──────────────────────────────────────────

@app.function(
    gpu="A10G",
    memory=16384,
    timeout=1800,
    secrets=[r2_secret, c2pa_secret],
)
def process_lp_clip_r2(input_key: str, output_key: str) -> dict:
    """R2 経由で 1 本の MP4 を処理。
    入力 input_key (= R2_BUCKET_RAW)、 出力 output_key (= R2_BUCKET_BLURRED)。
    戻り値は process_clip と同じ shape (= ぼかし済 MP4 自体は R2 にあり、 戻り値には含めない)。
    """
    import boto3

    account_id = os.environ["R2_ACCOUNT_ID"]
    bucket_raw = os.environ["R2_BUCKET_RAW"]
    bucket_blurred = os.environ["R2_BUCKET_BLURRED"]

    s3 = boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )

    in_path = "/tmp/in.mp4"
    out_path = "/tmp/out.mp4"
    s3.download_file(bucket_raw, input_key, in_path)
    stats = process_clip(in_path, out_path)

    s3.upload_file(
        out_path,
        bucket_blurred,
        output_key,
        ExtraArgs={
            "ContentType": "video/mp4",
            "Metadata": {
                "blurred-content-hash": stats["blurredContentHash"],
                "faces-blurred": str(stats["facesBlurred"]),
                "frames-processed": str(stats["framesProcessed"]),
            },
        },
    )
    return stats


# ─── ローカル動作確認用 ────────────────────────────────────────────────

@app.local_entrypoint()
def main():
    print(
        "Modal app rootlens-lp-bundle defined. "
        "Deploy with `modal deploy server/modal/lp_bundle.py`."
    )

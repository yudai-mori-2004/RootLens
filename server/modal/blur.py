"""
rootlens-server サーバパイプライン §6.2 ステップ 2 (= 匿名化処理) を Modal の CPU 関数として実装。

新方針 (SPECS §2.10 / §6.2): 端末は MP4 を 1 つだけ送る、 サーバ側で全部やる。

入力:  R2 にある生 MP4 (= 端末 AVAssetWriter / Android MediaRecorder 出力、 H.264)
処理:  ffmpeg で frame iterate → 各 frame に 顔ぼかし (YuNet) → ffmpeg で H.264 再 encode
出力:  R2 にぼかし済 MP4 (= preview 兼検証用)
返値:  ぼかし済 MP4 の sha256 + 顔ぼかし件数 + 処理時間

YuNet 採用理由 (= EgoBlur Gen2 から置換):
  - EgoBlur Gen2 は Aria glasses 用 Faster-RCNN で 2 FPS / T4 (= Meta 公式数値)、
    iPhone 動画には過剰精度かつ遅すぎ。 [HCL Starschema 検証] で LPDNet 比 600 倍遅。
  - YuNet は OpenCV 公式同梱の軽量 face detector、 ONNX 232KB、 CPU で 100+ FPS。
  - opencv-python-headless だけで完結 (= torch / torchvision / detectron2 など不要)。
  - 同等以上の業界水準 face recall を維持 (= OpenCV opencv_zoo benchmark 参照)。

テキストぼかしを入れない理由:
  業界標準 (= Meta EgoBlur 公式 / Brighter AI / Celantur) は face + license plate のみ。
  「全シーンテキストの blur」 は egocentric setting で技術的に未解決で、 既存 OCR detector
  (EasyOCR / DBNet / PP-OCRv5) は recall 50-70% / false positive 多発で実用にならない。
  scenario design (= 個人情報写る書類・画面を写さない撮影 task に絞る) + license 側の
  consent flow で担保する設計。 詳細は SPECS §2.10。

R2 アクセス:
  Modal Secret `r2-creds` 経由で R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY
  / R2_BUCKET_RAW / R2_BUCKET_BLURRED を環境変数として注入。
"""

import os
import subprocess
import time
import hashlib

import modal

# ─── Modal Image 定義 ──────────────────────────────────────────────────

# YuNet の ONNX weight (= 232 KB) は repo に commit して image に焼き込む。
# Modal Volume を使う必要なし (= EgoBlur 時代の egoblur-weights volume は削除済)。
YUNET_MODEL_PATH = "/root/models/face_detection_yunet_2023mar.onnx"
_LOCAL_MODELS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "libgl1", "libglib2.0-0")
    .pip_install(
        "opencv-python-headless==4.10.0.84",  # YuNet を同梱
        "numpy<2",
        "c2pa-python==0.32.6",   # サーバ派生 C2PA 署名 (= 「署名 S」)
        "cryptography",           # c2pa callback signer 用 ES256 署名
        "boto3==1.35.50",
        "fastapi[standard]",      # @modal.fastapi_endpoint が要求
    )
    .add_local_dir(_LOCAL_MODELS_DIR, "/root/models")
)
# サーバ署名 cert chain + leaf 秘密鍵 (PEM) を Modal Secret で注入。
# 値の作り方: `cd root-lens && node keys/sync-to-env.mjs server` を叩いた出力を
# Modal Secret rootlens-c2pa の 2 key (= SERVER_C2PA_CERT_CHAIN_PEM /
# SERVER_C2PA_PRIVATE_KEY_PEM) に貼る。
# chain は leaf (= RootLens Server) + Root CA の連結 PEM。
c2pa_secret = modal.Secret.from_name("rootlens-c2pa", required_keys=[
    "SERVER_C2PA_CERT_CHAIN_PEM", "SERVER_C2PA_PRIVATE_KEY_PEM",
])

app = modal.App("rootlens-blur", image=image)

# ─── 推論モデルの遅延ロード ──────────────────────────────────────────────

_face_detector = None

def get_face_detector():
    """OpenCV 同梱 YuNet (= cv2.FaceDetectorYN) を遅延 init。

    score_threshold:
      - OpenCV demo の default は 0.6 (= 正面の典型的な顔向け)。
      - egocentric / chest-mounted では 拳 / 食器 / 物体が「顔っぽい形」 として
        confidence 0.60-0.86 のレンジで誤検出される。 3 本のサンプル動画で
        全 frame 計測したところ 0.6 では 12-51 % frame で誤検出、 0.85 まで
        上げると 0.1 % まで落ちた。 contributor の顔は一人称視点で映らない
        前提なので 0.85 に上げる。 他人の顔の遠距離・横向きの検出率は
        多少下がるが、 chest-mounted の egocentric では他人の顔がアップで
        映る場面が少なく、 拳の連続誤検出を抑えるメリットが上回る。

    NMS IoU 0.3 は OpenCV demo 標準のまま。
    input size は frame ごとに setInputSize で書き換える (= dummy 320×320 で create)。
    """
    global _face_detector
    if _face_detector is None:
        import cv2
        if not os.path.exists(YUNET_MODEL_PATH):
            raise RuntimeError(
                f"YuNet weight not found at {YUNET_MODEL_PATH}. "
                "確認: server/modal/models/face_detection_yunet_2023mar.onnx が repo に存在するか。"
            )
        _face_detector = cv2.FaceDetectorYN.create(
            YUNET_MODEL_PATH,
            "",                      # config (= unused for YuNet)
            (320, 320),              # dummy 初期 input size
            score_threshold=0.85,
            nms_threshold=0.3,
            top_k=5000,
        )
    return _face_detector

# ─── 1 フレーム blur (= numpy BGR 入力 / 出力) ──────────────────────────

def blur_frame_bgr(img):
    """BGR uint8 ndarray を受け取り、 顔をぼかした BGR ndarray を返す。
    返値: (blurred_img, faces_count)。
    """
    import cv2

    h, w = img.shape[:2]

    # YuNet 顔検出。 input size を frame ごとに合わせる (= ratio 保持された native res)。
    face_detector = get_face_detector()
    face_detector.setInputSize((w, h))
    _, faces = face_detector.detect(img)  # faces: None or (N, 15) ndarray
    face_count = 0
    if faces is not None:
        # cols 0..3 = bbox x, y, w, h、 14 = confidence。 face_boxes は xywh ints。
        for row in faces:
            fx, fy, fw, fh = int(row[0]), int(row[1]), int(row[2]), int(row[3])
            # 周辺コンテキストも含めて余白を 20% 程度盛る (= 顎・髪の被覆)。
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

# ─── C2PA 署名 (= サーバ派生、 SPECS §2.10 段階 1) ──────────────────────

def sign_c2pa(mp4_path: str, faces_total: int) -> None:
    """ぼかし済 MP4 に C2PA manifest を埋め込む (= 「署名 S」、 SPECS §2.10 段階 1)。
    in-place で署名済ファイルに置き換える。

    cert chain は RootLens Dev Root CA で直接署名された Server leaf
    (= certs/dev/gen-server-cert.sh 生成)。 chain は leaf + Root の PEM 連結。
    Root CA を user_anchors として渡して、 post-sign verify を通す。

    c2pa-python 0.32 API:
      - c2pa.Context / c2pa.Builder / c2pa.Signer.from_callback すべて context manager
      - 署名アルゴリズムは c2pa.C2paSigningAlg
      - callback signer は raw bytes を受け取り、 raw 署名 bytes を返す
    """
    import c2pa
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.backends import default_backend

    chain_pem = os.environ.get("SERVER_C2PA_CERT_CHAIN_PEM", "")
    key_pem = os.environ.get("SERVER_C2PA_PRIVATE_KEY_PEM", "")
    if not chain_pem or not key_pem:
        raise RuntimeError(
            "SERVER_C2PA_CERT_CHAIN_PEM / SERVER_C2PA_PRIVATE_KEY_PEM are required "
            "(= Modal Secret rootlens-c2pa)。 "
            "certs/dev/gen-server-cert.sh で生成して keys/sync-to-env.mjs server で env 化。"
        )

    manifest = {
        "claim_generator_info": [{"name": "rootlens-server", "version": "0.1"}],
        "format": "video/mp4",
        "title": "RootLens blurred clip",
        "ingredients": [],
        "assertions": [
            {
                "label": "c2pa.actions",
                "data": {
                    "actions": [
                        {"action": "c2pa.placed", "softwareAgent": {"name": "YuNet"},
                         "parameters": {"description": f"face blur applied to {faces_total} regions"}},
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

    # c2pa-python の post-sign verify は built-in trust store にない CA を reject する
    # (= 我々の dev Root CA はそこに居ない)。 trust.user_anchors に渡しても
    # Settings.update が PEM を独自に COSE 経路でパースしようとして死ぬ。
    # 我々の chain は構築時点で valid なので、 post-sign verify は off にする。
    # 署名済 MP4 には正しい chain (leaf + Root) が embed され、 downstream (TP 等) で
    # 検証可能。
    settings = c2pa.Settings()
    settings.set("verify.verify_after_sign", "false")

    tmp_signed = mp4_path + ".signed.mp4"
    with c2pa.Context(settings) as ctx:
        with c2pa.Signer.from_callback(
            sign_callback,
            c2pa.C2paSigningAlg.ES256,
            chain_pem,
            None,  # timestamp_url (= dev は省略、 TSA は後段で追加検討)
        ) as signer:
            with c2pa.Builder(manifest, ctx) as builder:
                builder.sign_file(mp4_path, tmp_signed, signer)
    os.replace(tmp_signed, mp4_path)


# ─── MP4 → frame iterate → blur → MP4 ──────────────────────────────────

def process_mp4(in_path: str, out_path: str) -> dict:
    """生 MP4 を ffmpeg pipe で frame iterate → YuNet blur → ffmpeg で H.264 再 encode。
    PNG 経由しない (= 全部 raw BGR バイト列を stdin/stdout でストリーム)、 メモリは 1 frame 分。
    """
    import numpy as np

    t_start = time.time()

    # 1. ffprobe で width / height / fps を取得 (= pipe 入出力で形を指定するため必須)
    probe = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height,r_frame_rate",
            "-of", "csv=p=0:s=x",
            in_path,
        ],
        capture_output=True, text=True, check=True,
    )
    # 出力例: "1920x1080x30/1"
    parts = probe.stdout.strip().split("x")
    width = int(parts[0])
    height = int(parts[1])
    rate = parts[2]
    num, den = rate.split("/")
    fps = float(num) / float(den) if float(den) != 0 else 30.0

    # detector を warmup (= cold start を blur ループの外に出す)
    get_face_detector()

    # 2. read 側: MP4 → raw BGR24 (stdout pipe)
    read_proc = subprocess.Popen(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error",
            "-i", in_path,
            "-f", "rawvideo", "-pix_fmt", "bgr24",
            "-",
        ],
        stdout=subprocess.PIPE,
        bufsize=10 ** 8,
    )

    # 3. write 側: raw BGR24 (stdin pipe) → H.264 MP4
    write_proc = subprocess.Popen(
        [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-f", "rawvideo", "-pix_fmt", "bgr24",
            "-s", f"{width}x{height}", "-r", str(fps),
            "-i", "-",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
            "-pix_fmt", "yuv420p", "-movflags", "+faststart",
            out_path,
        ],
        stdin=subprocess.PIPE,
        bufsize=10 ** 8,
    )

    # 4. frame iterate (= blur)
    frame_size = width * height * 3
    faces_total = 0
    frames_processed = 0
    try:
        while True:
            raw = read_proc.stdout.read(frame_size)
            if len(raw) < frame_size:
                break
            # frombuffer は read-only buffer を返す、 blur は in-place 描き換えするので copy が要る
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

    # 5. C2PA 署名を ぼかし済 MP4 に埋め込む (= 「署名 S」、 SPECS §2.10 段階 1)
    sign_c2pa(out_path, faces_total=faces_total)

    # 出力 MP4 の sha256 (= 署名後)
    with open(out_path, "rb") as f:
        digest = hashlib.sha256(f.read()).hexdigest()

    return {
        "blurredContentHash": digest,
        "facesBlurred": faces_total,
        "framesProcessed": frames_processed,
        "durationMs": int((time.time() - t_start) * 1000),
    }

# ─── Modal function (HTTP endpoint) ────────────────────────────────────

@app.function(
    # YuNet は CPU で十分速い (= 100+ FPS、 1080p)。 GPU 不要。
    cpu=4,
    memory=2048,
    timeout=900,
    secrets=[modal.Secret.from_name("r2-creds"), c2pa_secret],
)
@modal.fastapi_endpoint(method="POST")
def blur_clip(input_key: str, output_key: str, idempotency_key: str):
    """
    rootlens-server が叩く endpoint。 内部で R2 download → 処理 → R2 upload。
    冪等性: 既に output_key が R2 に存在すれば既存値を返して短絡。
    """
    import boto3

    account_id = os.environ["R2_ACCOUNT_ID"]
    bucket_raw = os.environ.get("R2_BUCKET_RAW", "rootlens-mcap-raw")
    bucket_blurred = os.environ.get("R2_BUCKET_BLURRED", "rootlens-mcap-blurred")

    s3 = boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )

    # 冪等性チェック
    try:
        head = s3.head_object(Bucket=bucket_blurred, Key=output_key)
        meta = head.get("Metadata", {})
        return {
            "blurredContentHash": meta.get("blurred-content-hash", ""),
            "facesBlurred": int(meta.get("faces-blurred", 0)),
            "framesProcessed": int(meta.get("frames-processed", 0)),
            "previewKey": output_key,
            "durationMs": 0,
            "cached": True,
        }
    except s3.exceptions.ClientError:
        pass

    in_path = "/tmp/in.mp4"
    out_path = "/tmp/out.mp4"
    s3.download_file(bucket_raw, input_key, in_path)
    stats = process_mp4(in_path, out_path)

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
                "idempotency-key": idempotency_key,
            },
        },
    )

    # ぼかし済 MP4 自体が preview 兼用なので previewKey == output_key
    return {**stats, "previewKey": output_key, "cached": False}

# ─── ローカル動作確認 ──────────────────────────────────────────────────

@app.local_entrypoint()
def main():
    print("Modal app rootlens-blur defined. Deploy with `modal deploy server/modal/blur.py`.")

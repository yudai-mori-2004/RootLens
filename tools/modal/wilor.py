"""
Pipeline 3: WiLoR 手ポーズ推定 (= GPU 重処理、 手動トリガー) を Modal の GPU 関数として実装。

入力:  signature_hash (= raw/<signature_hash>/rgb.mp4 を読む)
処理:  ぼかし済 MP4 の各フレームを WiLoR-mini に通し、 フレームごとの手ポーズを推定する
出力:  processed/<signature_hash>/wilor.jsonl (= フレームごとの推定結果。 DATA_SPECS §4.4)

DATA_SPECS §4。 これは「1 クリップに対する重い計算処理」であり、 raw を元に計算した追加情報を
processed/ に raw と同じ signature_hash キーで書き出すだけ。 複数クリップをデータセット形式
(= LeRobot v3 等) にまとめる作業はこのパイプラインに含まれない (= 事後に別途行う集計)。

wilor.jsonl レイアウト:
  1 行目      ヘッダー (= モデル名 / バージョン / fps / total_frames / 各フィールドの shape)
  2 行目以降  1 行 = 1 フレーム。 フィールドは DATA_SPECS §4.3:
    frame_index        int
    hand_present       [2]        (= [left, right] bool)
    pred_keypoints_3d  [2, 21, 3]
    pred_cam_t_full    [2, 3]
    global_orient      [2, 3]     (= axis-angle)
    hand_pose          [2, 45]    (= 15 finger 関節 × axis-angle 3)
  手が未検出のフレームはゼロ埋め。
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
        "git+https://github.com/warmshao/WiLoR-mini.git",
        "torch==2.4.0",
        "torchvision==0.19.0",
        "ultralytics",
        "numpy<2",
        "opencv-python-headless==4.10.0.84",
        "boto3==1.35.50",
        "fastapi[standard]",
    )
)

app = modal.App("rootlens-wilor", image=image)

MODEL_NAME = "WiLoR-mini"
MODEL_SOURCE = "https://github.com/warmshao/WiLoR-mini"

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


def _to_numpy(x):
    """torch.Tensor / numpy / list を numpy array に揃える。"""
    import numpy as np
    if hasattr(x, "detach"):
        return x.detach().cpu().numpy()
    return np.asarray(x)


def _extract_hand_frame(rgb_bgr) -> dict:
    """1 frame の BGR 画像から WiLoR-mini で手ポーズを抽出し、 DATA_SPECS §4.3 のフィールドを
    [left, right] の 2 要素で返す。 未検出側はゼロ埋め。

    WiLoR-mini の wilor_preds dict ([1] 参照):
      - "pred_keypoints_3d": [1, 21, 3]  canonical hand-local space
      - "pred_cam_t_full":   [1, 3]      camera-space wrist 位置
      - "global_orient":     [1, 1, 3]   axis-angle
      - "hand_pose":         [1, 15, 3]  axis-angle × 15 finger 関節
      - "is_right":          bool        左右判定

    [1] https://github.com/warmshao/WiLoR-mini
    """
    import numpy as np

    pipe = get_wilor_pipeline()
    # detection が無い場合は outputs == [] (= throw されない)。 GPU OOM 等は propagate。
    outputs = pipe.predict(rgb_bgr)

    zeros_kp = [[0.0, 0.0, 0.0] for _ in range(21)]
    keypoints = [list(zeros_kp), list(zeros_kp)]          # [2, 21, 3]
    cam_t = [[0.0, 0.0, 0.0], [0.0, 0.0, 0.0]]            # [2, 3]
    global_orient = [[0.0, 0.0, 0.0], [0.0, 0.0, 0.0]]    # [2, 3]
    hand_pose = [[0.0] * 45, [0.0] * 45]                  # [2, 45]
    present = [False, False]

    for out in outputs:
        if not isinstance(out, dict):
            continue
        preds = out.get("wilor_preds", {})
        idx = 1 if bool(out.get("is_right", False)) else 0

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
                cam_t[idx] = [float(ct_arr[0]), float(ct_arr[1]), float(ct_arr[2])]

        go = preds.get("global_orient")
        if go is not None:
            go_arr = _to_numpy(go).reshape(-1)
            if go_arr.size >= 3:
                global_orient[idx] = go_arr[:3].astype(np.float32).tolist()

        hp = preds.get("hand_pose")
        if hp is not None:
            hp_arr = _to_numpy(hp).reshape(-1)
            if hp_arr.size >= 45:
                hand_pose[idx] = hp_arr[:45].astype(np.float32).tolist()

    return {
        "hand_present": present,
        "pred_keypoints_3d": keypoints,
        "pred_cam_t_full": cam_t,
        "global_orient": global_orient,
        "hand_pose": hand_pose,
    }


# ─── Modal function (HTTP endpoint) ────────────────────────────────────

def _wilor_impl(signature_hash: str):
    """Pipeline 3 のロジック本体。 web endpoint と RPC 経路で共通利用。
    webhook デコレータ付き関数は `.remote()` 不可なので、 ロジックを切り出して両方から呼ぶ。
    """
    import boto3

    account_id = os.environ["R2_ACCOUNT_ID"]
    bucket_raw = os.environ.get("R2_BUCKET_RAW", "rootlens-raw")
    bucket_processed = os.environ.get("R2_BUCKET_PROCESSED", "rootlens-processed")

    s3 = boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )

    rgb_key = f"raw/{signature_hash}/rgb.mp4"
    output_key = f"processed/{signature_hash}/wilor.jsonl"

    # 冪等性チェック: 既に wilor.jsonl があれば再計算しない。
    try:
        s3.head_object(Bucket=bucket_processed, Key=output_key)
        head = s3.get_object(Bucket=bucket_processed, Key=output_key)
        first = head["Body"].read().decode().split("\n", 1)[0]
        header = json.loads(first) if first.strip() else {}
        return {
            "totalFrames": int(header.get("total_frames", 0)),
            "fps": float(header.get("fps", 0.0)),
            "handsDetectedAvg": None,
            "durationMs": None,
            "outputKey": output_key,
            "cached": True,
        }
    except s3.exceptions.ClientError:
        pass

    t_start = time.time()
    work_dir = "/tmp/wilor_work"
    if os.path.exists(work_dir):
        subprocess.run(["rm", "-rf", work_dir], check=True)
    os.makedirs(work_dir, exist_ok=True)

    rgb_path = f"{work_dir}/rgb.mp4"
    s3.download_file(bucket_raw, rgb_key, rgb_path)

    # fps + frame 数を ffprobe で取得
    probe = subprocess.run(
        ["ffprobe", "-v", "error",
         "-select_streams", "v:0",
         "-show_entries", "stream=nb_frames,r_frame_rate",
         "-of", "default=nokey=1:noprint_wrappers=1",
         rgb_path],
        capture_output=True, text=True, check=True,
    )
    plines = probe.stdout.strip().split("\n")
    rate_str = plines[0]
    nb_frames = int(plines[1]) if len(plines) > 1 and plines[1].isdigit() else 0
    num, den = rate_str.split("/")
    fps = float(num) / float(den) if float(den) != 0 else 30.0

    # cv2 で各 frame を decode して WiLoR に通し、 wilor.jsonl を書き出す
    import cv2 as _cv2

    out_path = f"{work_dir}/wilor.jsonl"
    hands_detected_total = 0
    written = 0
    cap = _cv2.VideoCapture(rgb_path)
    try:
        with open(out_path, "w") as out_f:
            # ヘッダー行 (= モデル名 / バージョン / fps / total_frames / 各フィールド shape)
            out_f.write(json.dumps({
                "model": MODEL_NAME,
                "source": MODEL_SOURCE,
                "signature_hash": signature_hash,
                "fps": fps,
                "total_frames": nb_frames,
                "fields": {
                    "hand_present": [2],
                    "pred_keypoints_3d": [2, 21, 3],
                    "pred_cam_t_full": [2, 3],
                    "global_orient": [2, 3],
                    "hand_pose": [2, 45],
                },
            }) + "\n")

            frame_index = 0
            while True:
                ok, frame = cap.read()
                if not ok:
                    break
                hand = _extract_hand_frame(frame)
                hands_detected_total += int(hand["hand_present"][0]) + int(hand["hand_present"][1])
                out_f.write(json.dumps({"frame_index": frame_index, **hand}) + "\n")
                frame_index += 1
            written = frame_index
    finally:
        cap.release()

    # frame 数が ffprobe で取れなかった場合は実際の decode 数で埋める
    if nb_frames == 0:
        nb_frames = written

    s3.upload_file(
        out_path, bucket_processed, output_key,
        ExtraArgs={"ContentType": "application/x-ndjson"},
    )

    hands_avg = float(hands_detected_total) / float(written) if written > 0 else 0.0
    return {
        "totalFrames": written,
        "fps": fps,
        "handsDetectedAvg": hands_avg,
        "durationMs": int((time.time() - t_start) * 1000),
        "outputKey": output_key,
        "cached": False,
    }


# ─── 公開 endpoint (webhook + RPC) ─────────────────────────────────────

@app.function(
    gpu="A10G",
    memory=16384,
    timeout=43200,
    secrets=[modal.Secret.from_name("r2-creds")],
)
@modal.fastapi_endpoint(method="POST")
def wilor(signature_hash: str):
    """Web endpoint (= POST /wilor?signature_hash=...)。 同期 150 秒で 303 redirect する Modal の
    仕様により、 長尺は curl から扱いにくい。 一括バッチは下の `wilor_rpc` を `.remote()` で呼ぶ。"""
    return _wilor_impl(signature_hash)


@app.function(
    gpu="A10G",
    memory=16384,
    timeout=43200,
    secrets=[modal.Secret.from_name("r2-creds")],
)
def wilor_rpc(signature_hash: str):
    """RPC 経路 (= modal SDK の `.remote()` で叩く)。 ロジックは webhook と完全同一。"""
    return _wilor_impl(signature_hash)


# ─── ローカル動作確認 ──────────────────────────────────────────────────

@app.local_entrypoint()
def main():
    print("Modal app rootlens-wilor defined. Deploy with `modal deploy tools/modal/wilor.py`.")

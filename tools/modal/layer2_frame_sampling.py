"""
rootlens-server サーバパイプライン Pipeline 2 第 2 層 (= フレームサンプリング画像解析、 15 点)
を Modal の CPU 関数として実装。

入力: R2 上の生 MP4 (= raw/<content_id>/rgb.mp4) + sample_interval_sec
処理:
  1. R2 から MP4 を /tmp に download
  2. cv2.VideoCapture で開き、 int(fps * sample_interval_sec) 間隔で 1 フレームずつ抽出
  3. 各サンプルフレームについて 4 指標を計算
     - brightness_in_range_ratio (4 点): グレースケール平均輝度 ∈ [40, 240] のフレーム割合
     - sharpness_pass_ratio       (4 点): cv2.Laplacian(gray, CV_64F).var() >= 100 の割合
     - optical_flow_pass_ratio    (4 点): Farneback 平均フロー量 >= 1.0 px の割合
     - frame_diversity            (3 点): 連続サンプル間の HSV ヒストグラム チ二乗距離平均を
                                          閾値で正規化 (= 0..1)
  4. score = 四捨五入した 0..15 の整数

出力: JSON
  {
    "score": int (0..15),
    "brightnessInRangeRatio": float (0..1),
    "sharpnessPassRatio":     float (0..1),
    "opticalFlowPassRatio":   float (0..1),
    "frameDiversity":         float (0..1)
  }

詳細は document/v0.1.3/tasks/05-pipeline-2-layer-2-frame-sampling/README.md と
DATA_SPECS_JA.md §3.2.2 / §3.2.4 第 2 層内訳を参照。

R2 アクセス:
  Modal Secret `r2-creds` 経由で R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY
  / R2_BUCKET_RAW を環境変数として注入。

エッジケース:
  - fps が取れない (= 0 / NaN) → fps=30 仮定
  - 1 フレームのみ → optical_flow / diversity は連続ペアが作れないので 0.0
  - 全フレーム同一 → diversity 0.0、 optical flow ~0
  - 真っ暗 (平均輝度 < 40) / 真っ白 (> 240) → brightness_in_range_ratio = 0.0
"""

import os
import time

import modal

# ─── Modal Image 定義 ──────────────────────────────────────────────────

image = (
    modal.Image.debian_slim(python_version="3.11")
    # libgl1 / libglib2.0-0 は opencv-python-headless でも cv2 が dlopen 経由で要求する。
    .apt_install("libgl1", "libglib2.0-0")
    .pip_install(
        "opencv-python-headless==4.10.0.84",
        "numpy<2",
        "boto3==1.35.50",
        "fastapi[standard]",  # @modal.fastapi_endpoint が要求
    )
)

app = modal.App("rootlens-layer2-frame-sampling", image=image)

# ─── 指標計算の閾値 (= DATA_SPECS_JA.md §3.2.4 第 2 層初期値) ──────────

# 平均輝度がこの範囲内なら「適正露出」 (= 真っ暗 / 真っ白の検出)
BRIGHTNESS_MIN = 40.0
BRIGHTNESS_MAX = 240.0

# ラプラシアン分散がこの値以上なら「シャープ」
SHARPNESS_THRESHOLD = 100.0

# Farneback 平均フロー量がこの px 以上なら「動きあり」
OPTICAL_FLOW_THRESHOLD = 1.0

# HSV ヒストグラムのチ二乗距離平均がこの値以上で diversity=1.0 にクリップ
# (= 経験的に同一画像なら 0、 シーン切り替えで数百〜数千になる、 一般的な動き映像で
#    数十オーダー、 200 を「十分な変化」 の目安として正規化)。 運用データで調整する。
DIVERSITY_NORMALIZE_THRESHOLD = 200.0

# HSV ヒストグラム binning (= H 50 bin × S 60 bin の 2D ヒスト、 OpenCV docs 推奨値)
# README の「256-bin」 表現に合わせるため、 ここでは H:50 × S:60 ではなく 1D 256-bin の
# grayscale ヒストグラムで近似する経路と、 OpenCV 標準の 2D HSV (H×S) の両方を試して
# 結果が一致する後者の HSV ヒスト経路を採用。 ただしビン数は spec の「256-bin HSV」 を
# 守るため H 16 × S 16 = 256 (= 合計 256 bin) にする。
HSV_HIST_BINS = (16, 16)
HSV_HIST_RANGES = (0, 180, 0, 256)

# 配点 (= DATA_SPECS_JA §3.2.4 第 2 層内訳)
SCORE_BRIGHTNESS = 4.0
SCORE_SHARPNESS = 4.0
SCORE_OPTICAL_FLOW = 4.0
SCORE_DIVERSITY = 3.0
SCORE_TOTAL = SCORE_BRIGHTNESS + SCORE_SHARPNESS + SCORE_OPTICAL_FLOW + SCORE_DIVERSITY  # 15

# Farneback のパラメータは OpenCV docs 標準値。
# downscale = 0.5 で 1080p → 540p に縮小してから計算 (= 4 倍以上速い、 平均フロー量の
# スケールも 0.5 倍されるが、 閾値 1.0px は元解像度比なので flow 値を 2 倍に戻す)。
OPTICAL_FLOW_DOWNSCALE = 0.5

# 連続サンプル間のフロー / ヒスト距離計算でも downscale したフレームを使う。
# brightness / sharpness は元解像度。

# ─── サンプルフレーム抽出 + 指標計算 ────────────────────────────────

def _compute_metrics(mp4_path: str, sample_interval_sec: float) -> dict:
    """MP4 を開き、 サンプルフレームから 4 指標を計算して dict で返す。

    1 パスで cap.read() を回し、 sample_index に当たるフレームのみ処理する。
    全サンプルフレームを numpy 配列に貯めると 600 frame × 1920×1080 BGR で ~3 GB なので、
    grayscale フレームと縮小フレームだけを memory に持つ (= 必要な指標を逐次計算)。
    """
    import cv2
    import numpy as np

    cap = cv2.VideoCapture(mp4_path)
    if not cap.isOpened():
        raise RuntimeError(f"cv2.VideoCapture failed to open {mp4_path}")

    try:
        fps = cap.get(cv2.CAP_PROP_FPS)
        # fps が 0 / NaN / 負値の MP4 (= 一部 Android MediaRecorder 出力) は 30 を仮定
        if not (fps and fps > 0 and fps == fps):  # fps == fps で NaN を弾く
            fps = 30.0

        # int(fps * sample_interval_sec) フレーム間隔で 1 フレーム拾う
        sample_step = max(1, int(round(fps * float(sample_interval_sec))))

        # サンプリング毎の中間結果。 メモリ節約のため最終 ratio 計算用カウンタだけ持つ。
        sample_count = 0
        brightness_pass = 0
        sharpness_pass = 0
        flow_pass = 0
        flow_pairs = 0
        diversity_sum = 0.0
        diversity_pairs = 0

        # 直前サンプルフレームの downscaled gray と HSV hist (= 連続ペア指標用)
        prev_gray_small = None
        prev_hist = None

        frame_idx = -1
        while True:
            grabbed = cap.grab()
            if not grabbed:
                break
            frame_idx += 1
            if frame_idx % sample_step != 0:
                continue

            ok, frame = cap.retrieve()
            if not ok or frame is None:
                continue

            # --- 1. brightness (= 元解像度の grayscale 平均輝度) ---
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            mean_brightness = float(np.mean(gray))
            if BRIGHTNESS_MIN <= mean_brightness <= BRIGHTNESS_MAX:
                brightness_pass += 1

            # --- 2. sharpness (= Laplacian 分散) ---
            try:
                lap = cv2.Laplacian(gray, cv2.CV_64F)
                sharpness = float(lap.var())
            except cv2.error:
                sharpness = 0.0
            if sharpness >= SHARPNESS_THRESHOLD:
                sharpness_pass += 1

            # --- 3. optical flow (= 連続ペア間 Farneback、 downscale) ---
            small = cv2.resize(
                gray, None,
                fx=OPTICAL_FLOW_DOWNSCALE, fy=OPTICAL_FLOW_DOWNSCALE,
                interpolation=cv2.INTER_AREA,
            )

            # --- 4. diversity 用 HSV ヒスト (= 同じく downscale したフレームで OK) ---
            small_color = cv2.resize(
                frame, None,
                fx=OPTICAL_FLOW_DOWNSCALE, fy=OPTICAL_FLOW_DOWNSCALE,
                interpolation=cv2.INTER_AREA,
            )
            hsv = cv2.cvtColor(small_color, cv2.COLOR_BGR2HSV)
            # H と S の 2 ch ヒスト、 V は明るさ変化に弱いので除外 (OpenCV 慣例)
            hist = cv2.calcHist(
                [hsv], [0, 1], None,
                list(HSV_HIST_BINS),
                list(HSV_HIST_RANGES),
            )
            cv2.normalize(hist, hist, alpha=0, beta=1, norm_type=cv2.NORM_MINMAX)

            if prev_gray_small is not None:
                try:
                    flow = cv2.calcOpticalFlowFarneback(
                        prev_gray_small, small,
                        None,
                        0.5, 3, 15, 3, 5, 1.2, 0,
                    )
                    # flow は (H, W, 2)、 各 px の (dx, dy)。 magnitude の平均を取る。
                    mag = np.sqrt(flow[..., 0] ** 2 + flow[..., 1] ** 2)
                    # downscale 分を戻して元解像度比の px に換算
                    mean_flow_px = float(np.mean(mag)) / OPTICAL_FLOW_DOWNSCALE
                except cv2.error:
                    mean_flow_px = 0.0
                if mean_flow_px >= OPTICAL_FLOW_THRESHOLD:
                    flow_pass += 1
                flow_pairs += 1

                try:
                    chi2 = float(
                        cv2.compareHist(prev_hist, hist, cv2.HISTCMP_CHISQR)
                    )
                except cv2.error:
                    chi2 = 0.0
                # numpy が inf / nan を返したら 0 扱い (= 全 bin 0 や denom 0 のとき)
                if not (chi2 == chi2) or chi2 == float("inf"):
                    chi2 = 0.0
                diversity_sum += chi2
                diversity_pairs += 1

            prev_gray_small = small
            prev_hist = hist
            sample_count += 1
    finally:
        cap.release()

    if sample_count == 0:
        # フレームが 1 枚も読めなかった (= 壊れた MP4) → 全指標 0
        return {
            "sampleCount": 0,
            "brightnessInRangeRatio": 0.0,
            "sharpnessPassRatio": 0.0,
            "opticalFlowPassRatio": 0.0,
            "frameDiversity": 0.0,
        }

    brightness_ratio = brightness_pass / sample_count
    sharpness_ratio = sharpness_pass / sample_count
    # 連続ペアが作れない (= サンプル 1 枚) ときは 0
    flow_ratio = (flow_pass / flow_pairs) if flow_pairs > 0 else 0.0
    diversity_mean = (diversity_sum / diversity_pairs) if diversity_pairs > 0 else 0.0
    diversity_normalized = min(1.0, diversity_mean / DIVERSITY_NORMALIZE_THRESHOLD)

    # 0..1 範囲に明示クリップ (= 浮動小数点の僅かなはみ出し対策)
    def _clip01(x: float) -> float:
        if x != x:  # NaN
            return 0.0
        return max(0.0, min(1.0, float(x)))

    return {
        "sampleCount": sample_count,
        "brightnessInRangeRatio": _clip01(brightness_ratio),
        "sharpnessPassRatio": _clip01(sharpness_ratio),
        "opticalFlowPassRatio": _clip01(flow_ratio),
        "frameDiversity": _clip01(diversity_normalized),
    }


def _compute_score(metrics: dict) -> int:
    """各 ratio に配点を掛けて合計、 四捨五入して 0..15 の整数を返す。"""
    raw = (
        metrics["brightnessInRangeRatio"] * SCORE_BRIGHTNESS
        + metrics["sharpnessPassRatio"] * SCORE_SHARPNESS
        + metrics["opticalFlowPassRatio"] * SCORE_OPTICAL_FLOW
        + metrics["frameDiversity"] * SCORE_DIVERSITY
    )
    # round(2.5) は banker's rounding で 2 になるため、 0.5 を足して int() で算術四捨五入
    rounded = int(raw + 0.5)
    return max(0, min(int(SCORE_TOTAL), rounded))


# ─── Modal function (HTTP endpoint) ────────────────────────────────────

@app.function(
    cpu=4,
    memory=2048,
    timeout=180,
    secrets=[modal.Secret.from_name("r2-creds")],
)
@modal.fastapi_endpoint(method="POST")
def analyze(content_id: str, sample_interval_sec: float = 3.0):
    """
    rootlens-server が叩く endpoint。 R2 から raw/<content_id>/rgb.mp4 を fetch し、
    サンプリングフレームから 4 指標 + 0..15 score を算出して返す。

    Args (query string):
        content_id:           生 MP4 を特定する content_id (= R2 key prefix 用)
        sample_interval_sec:  サンプリング間隔の秒数 (= default 3)

    冪等性:
        同じ content_id + sample_interval_sec で同じ入力 MP4 を読み、 同じ計算ロジックを
        通すので結果は決定的。 cache layer は server 側 (= Pipeline 2 の DB) が持つ。
    """
    import boto3

    t_start = time.time()

    account_id = os.environ["R2_ACCOUNT_ID"]
    bucket_raw = os.environ.get("R2_BUCKET_RAW", "rootlens-raw")

    s3 = boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )

    input_key = f"raw/{content_id}/rgb.mp4"
    in_path = "/tmp/in.mp4"
    s3.download_file(bucket_raw, input_key, in_path)

    metrics = _compute_metrics(in_path, sample_interval_sec=float(sample_interval_sec))
    score = _compute_score(metrics)

    return {
        "score": score,
        "brightnessInRangeRatio": metrics["brightnessInRangeRatio"],
        "sharpnessPassRatio": metrics["sharpnessPassRatio"],
        "opticalFlowPassRatio": metrics["opticalFlowPassRatio"],
        "frameDiversity": metrics["frameDiversity"],
        "sampleCount": metrics["sampleCount"],
        "durationMs": int((time.time() - t_start) * 1000),
    }


# ─── ローカル動作確認 ──────────────────────────────────────────────────

@app.local_entrypoint()
def main():
    print(
        "Modal app rootlens-layer2-frame-sampling defined. "
        "Deploy with `modal deploy tools/modal/layer2_frame_sampling.py`."
    )

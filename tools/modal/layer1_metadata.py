"""
rootlens-server Pipeline 2 第 1 層 (= メタデータ解析、 20 点) を Modal の CPU 関数として実装。

入力:  R2 raw bucket の `raw/<content_id>/sensors.jsonl` + `raw/<content_id>/imu_high_rate.jsonl`
処理:  JSONL を 1 行ずつ stream parse して 6 指標を集計、 各 0..1 正規化 × 配点 を合算
出力:  Layer1Score JSON (= camelCase キー、 score は 0..20 の整数)

6 指標 (= document/v0.1.3/tasks/04 / DATA_SPECS_JA §3.2.4 第 1 層内訳):

| 指標                          | 配点 | 算出                                                                      |
|-------------------------------|------|---------------------------------------------------------------------------|
| handLandmarkPresenceBoth      | 6    | 両手 21x2 = 42 ランドマーク全てフレーム内のフレーム割合                   |
| rgbSensorSyncRatio            | 4    | 有効な timestamp_ns + frame_index 行の割合                                |
| frameContinuity               | 4    | 1 - 欠番率 (= 0..max(frame_index) の期待列に対する穴の割合)               |
| trackingQuality               | 3    | tracking_state == 2 (= ARKit normal) のフレーム割合                       |
| handMovement                  | 2    | 手首ランドマーク変位の分散を閾値 (= 100 px²) で正規化 (clip 0..1)          |
| imuGravityCompliance          | 1    | 加速度 norm が 9.81 ± 0.5 m/s² 範囲のサンプル割合                          |

設計判断:

- **棄却閾値なし** (= SPECS §6.3 + task 04 README「やらないこと」 ─ 棄却閾値の適用)。 低スコアでも score を返す。
- **空ファイル / 不完全データは 0 で返す** (= 例外を吐かない)。 全フィールドが 0 の Layer1Score が「sensors が読めなかった / 中身がほぼ空」 のシグナル。
- **handMovement の閾値 100 px²**: 手首ランドマーク x/y のフレーム間変位 (差分) を全フレームで集めて分散を取る。 1080p で 30 fps の自然な動作だと手首は 5-20 px / frame 動くので分散は数 100 程度。 100 px² で 1.0 に飽和、 静止データ (= 分散 0) で 0.0。 線形 clip。
- **IMU 重力範囲 9.81 ± 0.5**: 加速度センサーの norm が重力 (= 9.81 m/s²) ± 0.5 に収まるサンプル割合。 端末を激しく揺らすと norm が 11+ や 7 以下に振れるので、 「自然に把持されている」 比率の proxy。 重力 + 線形加速度を区別しないので、 端末動作中に下がるのは仕様。
- **numpy で IMU だけベクトル化**: imu は 100Hz × 1800s = 180000 行と大きいので、 accel を一括 array にして np.linalg.norm で一括計算する。 sensors.jsonl は frame ごとの構造が重い (= 42 landmark) ので 1 行ずつの集計の方がメモリ効率が良い。

R2 アクセス:
  Modal Secret `r2-creds` 経由で R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY
  / R2_BUCKET_RAW を環境変数として注入。 boto3 で S3 互換エンドポイントへ接続。
"""

import json
import os
from typing import Any

import modal

# ─── Modal Image 定義 ──────────────────────────────────────────────────

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "numpy<2",
        "boto3==1.35.50",
        "fastapi[standard]",  # @modal.fastapi_endpoint が要求
    )
)

app = modal.App("rootlens-layer1-metadata", image=image)

# ─── 指標の配点 (= task 04 README) ─────────────────────────────────────

WEIGHT_HAND_PRESENCE = 6
WEIGHT_SYNC_RATIO = 4
WEIGHT_FRAME_CONTINUITY = 4
WEIGHT_TRACKING_QUALITY = 3
WEIGHT_HAND_MOVEMENT = 2
WEIGHT_IMU_GRAVITY = 1
WEIGHT_TOTAL = (
    WEIGHT_HAND_PRESENCE
    + WEIGHT_SYNC_RATIO
    + WEIGHT_FRAME_CONTINUITY
    + WEIGHT_TRACKING_QUALITY
    + WEIGHT_HAND_MOVEMENT
    + WEIGHT_IMU_GRAVITY
)
assert WEIGHT_TOTAL == 20, "配点の合計は 20 点 (= task 04 仕様)"

# handMovement の正規化分母 (= 1080p 自然動作の経験的目安、 100 px² で 1.0 に飽和)
HAND_MOVEMENT_VARIANCE_FULL = 100.0

# IMU 重力比較の許容幅 (= 9.81 ± 0.5 m/s²)
IMU_GRAVITY_TARGET = 9.81
IMU_GRAVITY_TOLERANCE = 0.5


# ─── ゼロスコア (= 空ファイル / 例外時の fallback) ─────────────────────

def _zero_score() -> dict[str, Any]:
    return {
        "score": 0,
        "handLandmarkPresenceBoth": 0.0,
        "rgbSensorSyncRatio": 0.0,
        "frameContinuity": 0.0,
        "trackingQuality": 0.0,
        "handMovement": 0.0,
        "imuGravityCompliance": 0.0,
    }


# ─── sensors.jsonl 集計 ────────────────────────────────────────────────

def _compute_sensors_metrics(sensors_text: str) -> dict[str, float]:
    """sensors.jsonl 全文から 5 指標 (= hand presence / sync / continuity / tracking / movement) を計算。

    1 行ずつ json.loads して running counters に積むだけ (= 全 frame を list に保持しない、
    メモリは O(1) で frame 数に依存しない)。 ただし handMovement だけは前フレームの
    手首 x/y を保持して差分を取るので、 直前 1 frame 分のメモリを使う。
    """
    total_rows = 0
    rows_with_ts_and_idx = 0
    rows_with_both_hands = 0
    rows_tracking_normal = 0
    frame_indices_seen: set[int] = set()
    max_frame_index = -1

    # 手首ランドマーク差分の分散用 (= MediaPipe 規約で wrist は index 0)
    prev_left_wrist: tuple[float, float] | None = None
    prev_right_wrist: tuple[float, float] | None = None
    # Welford-ish online accumulator (= 分散 = E[d^2] - E[d]^2、 d は 1 サンプルあたりの変位量)
    # 簡略のため variance = mean(d^2) - mean(d)^2 を sum_d / sum_d2 / n から計算する。
    move_n = 0
    move_sum = 0.0
    move_sum_sq = 0.0

    for line in sensors_text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            # 壊れた行は total_rows に含めて分母に出すべきか / 含めないか?
            # 仕様上「不完全データは 0 を返す」 が、 ここでは「読めた行を分母にする」 設計。
            # 壊れた行は無視 (= ratio 計算から除外)。
            continue
        if not isinstance(row, dict):
            continue
        total_rows += 1

        # rgb_sensor_sync_ratio: timestamp_ns + frame_index が両方 int で揃っている
        ts = row.get("timestamp_ns")
        fi = row.get("frame_index")
        if isinstance(ts, int) and isinstance(fi, int):
            rows_with_ts_and_idx += 1

        # frame_continuity: frame_index を集める (= set で穴を判定)
        if isinstance(fi, int) and fi >= 0:
            frame_indices_seen.add(fi)
            if fi > max_frame_index:
                max_frame_index = fi

        # tracking_quality: tracking_state == 2
        ts_state = row.get("tracking_state")
        if isinstance(ts_state, int) and ts_state == 2:
            rows_tracking_normal += 1

        # hand_landmark_presence_both: 両手とも 21 関節揃っている
        hl = row.get("hand_landmarks")
        if isinstance(hl, dict):
            left = hl.get("left")
            right = hl.get("right")
            left_ok = isinstance(left, list) and len(left) == 21
            right_ok = isinstance(right, list) and len(right) == 21
            if left_ok and right_ok:
                rows_with_both_hands += 1

            # hand_movement: 両手とも 21 関節揃ったフレームでだけ wrist (= index 0) を取る。
            # 片手しか映っていないフレームは差分対象から除外 (= 過小評価しない)。
            if left_ok and right_ok:
                lw = left[0] if isinstance(left[0], dict) else None
                rw = right[0] if isinstance(right[0], dict) else None
                lx = lw.get("x") if isinstance(lw, dict) else None
                ly = lw.get("y") if isinstance(lw, dict) else None
                rx = rw.get("x") if isinstance(rw, dict) else None
                ry = rw.get("y") if isinstance(rw, dict) else None
                if (
                    isinstance(lx, (int, float))
                    and isinstance(ly, (int, float))
                    and isinstance(rx, (int, float))
                    and isinstance(ry, (int, float))
                ):
                    cur_left = (float(lx), float(ly))
                    cur_right = (float(rx), float(ry))
                    if prev_left_wrist is not None and prev_right_wrist is not None:
                        dlx = cur_left[0] - prev_left_wrist[0]
                        dly = cur_left[1] - prev_left_wrist[1]
                        drx = cur_right[0] - prev_right_wrist[0]
                        dry = cur_right[1] - prev_right_wrist[1]
                        # 左右の変位を 1 つのスカラ (= 平均移動量) として扱う
                        d_left_sq = dlx * dlx + dly * dly
                        d_right_sq = drx * drx + dry * dry
                        d_avg_sq = (d_left_sq + d_right_sq) / 2.0
                        # variance = E[d^2] - E[d]^2、 d は |変位|
                        d_avg = d_avg_sq ** 0.5
                        move_n += 1
                        move_sum += d_avg
                        move_sum_sq += d_avg_sq
                    prev_left_wrist = cur_left
                    prev_right_wrist = cur_right

    if total_rows == 0:
        return {
            "handLandmarkPresenceBoth": 0.0,
            "rgbSensorSyncRatio": 0.0,
            "frameContinuity": 0.0,
            "trackingQuality": 0.0,
            "handMovement": 0.0,
        }

    hand_presence = rows_with_both_hands / total_rows
    sync_ratio = rows_with_ts_and_idx / total_rows
    tracking_quality = rows_tracking_normal / total_rows

    # frame_continuity: 期待列 0..max_frame_index に対する欠番率を 1 から引く。
    # max_frame_index < 0 (= 1 つも frame_index が無い) は continuity 0。
    if max_frame_index >= 0:
        expected = max_frame_index + 1
        seen = len(frame_indices_seen)
        # 重複は穴を埋めない (= set で unique 数を取っているので自然に正しい)
        continuity = max(0.0, min(1.0, seen / expected))
    else:
        continuity = 0.0

    # hand_movement: variance を HAND_MOVEMENT_VARIANCE_FULL で正規化 (clip 0..1)
    if move_n >= 2:
        mean_d = move_sum / move_n
        mean_d_sq = move_sum_sq / move_n
        variance = max(0.0, mean_d_sq - mean_d * mean_d)
        hand_movement = max(0.0, min(1.0, variance / HAND_MOVEMENT_VARIANCE_FULL))
    else:
        hand_movement = 0.0

    return {
        "handLandmarkPresenceBoth": _clip01(hand_presence),
        "rgbSensorSyncRatio": _clip01(sync_ratio),
        "frameContinuity": _clip01(continuity),
        "trackingQuality": _clip01(tracking_quality),
        "handMovement": _clip01(hand_movement),
    }


# ─── imu_high_rate.jsonl 集計 ─────────────────────────────────────────

def _compute_imu_metrics(imu_text: str) -> dict[str, float]:
    """imu_high_rate.jsonl 全文から imuGravityCompliance を計算。

    100Hz × 1800s = 180000 行になるので、 accel を numpy array に詰めて norm を一括計算する。
    pure Python のループでも 5 秒には収まるが、 numpy で 1 行に纏める方が安全 + 簡潔。
    """
    import numpy as np

    norms_list: list[float] = []
    for line in imu_text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(row, dict):
            continue
        accel = row.get("accel")
        if not isinstance(accel, dict):
            continue
        x = accel.get("x")
        y = accel.get("y")
        z = accel.get("z")
        if not (isinstance(x, (int, float)) and isinstance(y, (int, float)) and isinstance(z, (int, float))):
            continue
        # norm は最後に np.sqrt で一括するため、 ここでは二乗和を貯める
        norms_list.append(float(x) * float(x) + float(y) * float(y) + float(z) * float(z))

    if not norms_list:
        return {"imuGravityCompliance": 0.0}

    norms_sq = np.asarray(norms_list, dtype=np.float64)
    norms = np.sqrt(norms_sq)
    lo = IMU_GRAVITY_TARGET - IMU_GRAVITY_TOLERANCE
    hi = IMU_GRAVITY_TARGET + IMU_GRAVITY_TOLERANCE
    in_range = np.sum((norms >= lo) & (norms <= hi))
    ratio = float(in_range) / float(norms.size)
    return {"imuGravityCompliance": _clip01(ratio)}


# ─── 補助関数 ──────────────────────────────────────────────────────────

def _clip01(x: float) -> float:
    """NaN / inf を 0、 範囲外は clip して 0..1 に揃える。"""
    try:
        v = float(x)
    except (TypeError, ValueError):
        return 0.0
    if v != v:  # NaN
        return 0.0
    if v < 0.0:
        return 0.0
    if v > 1.0:
        return 1.0
    return v


def _combine_score(metrics: dict[str, float]) -> int:
    """6 指標 (= 0..1) と配点から score (= 0..20 整数) を計算。"""
    total = (
        metrics["handLandmarkPresenceBoth"] * WEIGHT_HAND_PRESENCE
        + metrics["rgbSensorSyncRatio"] * WEIGHT_SYNC_RATIO
        + metrics["frameContinuity"] * WEIGHT_FRAME_CONTINUITY
        + metrics["trackingQuality"] * WEIGHT_TRACKING_QUALITY
        + metrics["handMovement"] * WEIGHT_HAND_MOVEMENT
        + metrics["imuGravityCompliance"] * WEIGHT_IMU_GRAVITY
    )
    # 四捨五入 + clip
    score = int(round(total))
    if score < 0:
        return 0
    if score > WEIGHT_TOTAL:
        return WEIGHT_TOTAL
    return score


# ─── R2 から JSONL を取得 ─────────────────────────────────────────────

def _fetch_text(s3, bucket: str, key: str) -> str:
    """R2 オブジェクトを utf-8 文字列で取得。 NoSuchKey 等は空文字を返す
    (= 不完全データは各指標 0、 仕様の「例外を吐かない」 を満たす)。"""
    try:
        obj = s3.get_object(Bucket=bucket, Key=key)
    except Exception:
        return ""
    body = obj.get("Body")
    if body is None:
        return ""
    try:
        return body.read().decode("utf-8")
    except (UnicodeDecodeError, AttributeError):
        return ""


# ─── Modal function (HTTP endpoint) ────────────────────────────────────

@app.function(
    cpu=2,
    memory=1024,
    timeout=60,
    secrets=[modal.Secret.from_name("r2-creds")],
)
@modal.fastapi_endpoint(method="POST")
def score(content_id: str):
    """
    Pipeline 2 第 1 層 entry point。

    Args (query string):
        content_id: クリップの content_id (= R2 prefix raw/<content_id>/ を読む)

    Returns:
        Layer1Score JSON (= camelCase キー、 score: 0..20 整数 + 6 sub-metric: 各 0..1 float)
    """
    import boto3

    # 入力 validation: content_id が無い / path traversal を弾く。
    # 例外を吐かないポリシーなので、 不正でも zero score を返す。
    if not isinstance(content_id, str) or not content_id or "/" in content_id or ".." in content_id:
        return _zero_score()

    account_id = os.environ.get("R2_ACCOUNT_ID")
    access_key = os.environ.get("R2_ACCESS_KEY_ID")
    secret_key = os.environ.get("R2_SECRET_ACCESS_KEY")
    bucket_raw = os.environ.get("R2_BUCKET_RAW", "rootlens-raw")
    if not (account_id and access_key and secret_key):
        # credentials が無い deploy は config エラーだが、 ポリシー上 zero を返す。
        return _zero_score()

    s3 = boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name="auto",
    )

    sensors_key = f"raw/{content_id}/sensors.jsonl"
    imu_key = f"raw/{content_id}/imu_high_rate.jsonl"

    sensors_text = _fetch_text(s3, bucket_raw, sensors_key)
    imu_text = _fetch_text(s3, bucket_raw, imu_key)

    try:
        sensors_metrics = _compute_sensors_metrics(sensors_text)
    except Exception:
        sensors_metrics = {
            "handLandmarkPresenceBoth": 0.0,
            "rgbSensorSyncRatio": 0.0,
            "frameContinuity": 0.0,
            "trackingQuality": 0.0,
            "handMovement": 0.0,
        }
    try:
        imu_metrics = _compute_imu_metrics(imu_text)
    except Exception:
        imu_metrics = {"imuGravityCompliance": 0.0}

    metrics = {**sensors_metrics, **imu_metrics}
    return {
        "score": _combine_score(metrics),
        "handLandmarkPresenceBoth": metrics["handLandmarkPresenceBoth"],
        "rgbSensorSyncRatio": metrics["rgbSensorSyncRatio"],
        "frameContinuity": metrics["frameContinuity"],
        "trackingQuality": metrics["trackingQuality"],
        "handMovement": metrics["handMovement"],
        "imuGravityCompliance": metrics["imuGravityCompliance"],
    }


# ─── ローカル動作確認 ──────────────────────────────────────────────────

@app.local_entrypoint()
def main():
    print(
        "Modal app rootlens-layer1-metadata defined. "
        "Deploy with `modal deploy tools/modal/layer1_metadata.py`."
    )

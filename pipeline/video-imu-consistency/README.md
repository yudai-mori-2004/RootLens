# video-imu-consistency

Video と IMU の整合性を GTSAM ImuFactor の 15D residual で算出するサーバーサイド CLI。

仕様: [`document/v0.1.2/tasks/03-video-imu-consistency/`](../../document/v0.1.2/tasks/03-video-imu-consistency/README.md)

## セットアップ

```sh
cd pipeline/video-imu-consistency
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

GTSAM (4.2+) は macOS arm64 / linux x86_64 に prebuilt wheel あり。それ以外は Boost + CMake から build が必要 (https://github.com/borglab/gtsam の手順に従う)。

## 入力ファイル

### Video

通常の mp4。最初の `--max-frames` フレーム (default 120) のみ処理。

### IMU JSON sidecar

```json
{
  "samples": [
    {
      "timestamp_ns": "1746230112345678901",
      "accel": [0.01, -0.05, 9.79],
      "gyro": [0.001, 0.002, -0.0005]
    }
  ]
}
```

- `timestamp_ns`: 文字列で渡す (JS bigint 互換)。video の `cv2.CAP_PROP_POS_MSEC` (movie 開始からの ms) と **同じ origin** であること。実機 capture では sensor-session の anchor monotonic ns を統一基準に使う想定。
- `accel`: m/s², body frame (gravity 込み)
- `gyro`: rad/s, body frame

## 使い方

```sh
python verify.py \
  --video sample.mp4 \
  --imu sample_imu.json \
  --intrinsics 1280,0,720,0,1280,540,0,0,1 \
  --max-frames 120 \
  --out result.json
```

`--intrinsics` は 9 値 (row-major) の K 行列。default は仮の 720p MEMS 推定値。実機で取った場合は sensor-session の `currentDeviceDescriptor` の active_format から取る。

## 出力

```json
{
  "video": "sample.mp4",
  "imu": "sample_imu.json",
  "n_frames": 120,
  "n_imu_samples": 24000,
  "fps": 30.0,
  "n_pairs": 118,
  "total_error": 12.45,
  "avg_mahalanobis": 0.105
}
```

- `total_error`: 全 factor の Mahalanobis 距離 (graph error)
- `avg_mahalanobis`: factor 数で割った平均

## 解釈

- **実撮影 (整合)**: avg_mahalanobis が 0.1 〜 0.5 程度
- **画面撮影 (不整合)**: avg_mahalanobis が 5+ (visual ego-motion と IMU 物理運動が乖離)
- **静止三脚 (両方ほぼ 0)**: 値は小さいが ill-conditioned のため信頼度低

具体的な閾値は実データで分布を取ってから決める (Phase 2 / 3)。

## 制限事項 (sandbox 段階)

- 視覚 scale は unobservable のため translation 部分は high-noise で重み付け。回転 + 短時間並進の整合性に依存。
- IMU bias の事前 calibration は省略。常時動作の sensor-session が記録するため、本番では bias 推定も factor graph に乗せる。
- frame と IMU の timestamp 同期は前提 (sensor-session の anchor を共有する設計)。同期ずれが大きいと residual が常に高出る。
- LiDAR depth / ARKit pose を補助 prior として加えていない (v0.1.2 統合フェーズで追加余地)。

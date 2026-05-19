# Task 15: 撮影パイプライン (= Pipeline 1) の実装

## 位置付け

SPECS §6.2 で定義された 3 パイプラインのうち、 **Pipeline 1 (撮影)** を iOS 上で実装するタスク。 完成系の配布形式は [task 17](../17-dataset-format/README.md) で確定済 (= LeRobotDataset v3 互換)。 本タスクは その上流である端末出力ファイル群を作る。

## 目的

iPhone 1 セッションの撮影で、 ARKit から同期した RGB + sensor stream を以下のファイル群として書き出し、 任意のストレージにアップロードできる状態にする。

| ファイル | 内容 | 形式 | rate |
|---|---|---|---|
| `rgb.mp4` | エゴセントリック RGB 映像 | H.264 (AVAssetWriter) | 30 fps |
| `sensors.jsonl` | per-frame の camera pose + tracking_state + IMU 軽量 sample | JSON Lines | 30 fps (= 映像と同期) |
| `imu_high_rate.jsonl` | 100 Hz の IMU 生サンプル (accel / gyro / orientation) | JSON Lines | 100 Hz |
| `camera_intrinsics.json` | fx / fy / cx / cy + RGB / depth 解像度 + デバイスモデル | JSON | セッション 1 回 |
| `depth/{frame_id}.png` | LiDAR depth map | 16-bit PNG, 144×256 mm | 30 fps (= Pro 機のみ) |

全ファイルで `ARFrame.timestamp` (= デバイス boot からの経過秒) を共通の時刻基準として frame index 同期できる。

## 採用方針

- **既存の `app/modules/arkit-capture` モジュールを拡張**。 現状は AVAssetWriter による MP4 録画のみ実装済 ([apps/modules/arkit-capture/ios/ArSessionController.swift](../../../app/modules/arkit-capture/ios/ArSessionController.swift))。 ここに sensor sampler を追加する
- センサーは独立ストリームとして書く (= MCAP のような統合コンテナを端末で組まない、 サーバ側 Pipeline 3 が parquet に変換する)
- JSON Lines を採用 (= 1 行 1 frame、 デバッグしやすい、 Swift で重い依存無しに書ける、 サイズも frame 数の小ささから無視できる)

## 出力ファイルのスキーマ

### sensors.jsonl (= 30 Hz、 1 行 = 1 frame)

```json
{
  "ts": 1234567.890,
  "frame_index": 42,
  "tracking_state": "normal",
  "tracking_reason": "",
  "camera_transform": [[1.0, 0.0, 0.0, 0.1], [0.0, 1.0, 0.0, 0.2], [0.0, 0.0, 1.0, 0.3], [0.0, 0.0, 0.0, 1.0]],
  "camera_intrinsics": [fx, 0, cx, 0, fy, cy, 0, 0, 1],
  "imu": {
    "orientation": [qx, qy, qz, qw],
    "angular_velocity": [wx, wy, wz],
    "linear_acceleration": [ax, ay, az]
  }
}
```

- `ts`: `ARFrame.timestamp`、 ARKit world frame と同期
- `camera_transform`: ARFrame.camera.transform を row-major 4×4 で
- `camera_intrinsics`: ARFrame.camera.intrinsics を row-major 9 要素で (= 全 frame 同一値だが冗長記録、 buyer 側でロード時に簡略化可)
- `imu` ブロック: CMDeviceMotion から、 RGB frame 時刻に最も近いサンプルを 1 つ拾う (= 30 Hz 視点の代表値)

### imu_high_rate.jsonl (= 100 Hz、 1 行 = 1 IMU sample)

```json
{
  "ts": 1234567.901,
  "orientation": [qx, qy, qz, qw],
  "angular_velocity": [wx, wy, wz],
  "linear_acceleration": [ax, ay, az]
}
```

CMDeviceMotion を 100 Hz で sampling、 そのまま書く。 `imu` フィールドは sensors.jsonl と同じ schema。

### camera_intrinsics.json (= セッション 1 回)

```json
{
  "device_model": "iPhone 15 Pro",
  "platform": "iOS",
  "os_version": "26.0",
  "rgb": {
    "width": 1280,
    "height": 720,
    "fps": 30,
    "fx": 906.5,
    "fy": 906.5,
    "cx": 640.0,
    "cy": 360.0
  },
  "depth": {
    "width": 256,
    "height": 144,
    "fx": 181.3,
    "fy": 181.3,
    "cx": 128.0,
    "cy": 72.0
  }
}
```

`depth` ブロックは LiDAR 搭載機のみ含む。 非対応機は省略。

### depth/{frame_index:06d}.png (= Pro 機のみ)

ARKit `sceneDepth.depthMap` (= float32, m 単位) を `uint16` mm に変換して 144×256 PNG として保存。 ファイル名は `rgb.mp4` の frame index に対応 (= sensors.jsonl の `frame_index` と同じ key で結合できる)。

## 実装 sub-task

- [ ] `ArSessionController.swift` に sensor sampler を追加
  - `ARSession` の delegate で `didUpdate frame: ARFrame` を捕まえる
  - frame ごとに `sensors.jsonl` に 1 行 append (= `FileHandle` で直書き)
  - LiDAR 機なら `frame.sceneDepth?.depthMap` を `vImage` で uint16 mm に変換 → PNG 書き出し
- [ ] `CMMotionManager` を 100 Hz で別 thread に起動
  - `deviceMotionUpdateInterval = 0.01`
  - block 内で `imu_high_rate.jsonl` に append
- [ ] セッション開始時に `camera_intrinsics.json` を 1 回書く
- [ ] セッション終了時に全 FileHandle を flush + close
- [ ] React Native bridge から 5 ファイルのパスを取得できる API を追加

## アップロード

- 既存の `app/src/services/clipPipeline.ts` を 拡張、 5 ファイルを 1 セッション分まとめてストレージに並列 PUT
- いずれかの PUT が失敗したら全体を retry (= 部分成功は許さない、 buyer 側で dataset を組めない壊れた状態を作らない)
- アップロード後に `POST /api/clips/:id/finalize` で Pipeline 2 を起動

## 成功条件

- [ ] 30 秒撮影で 5 ファイルが揃って出力される
- [ ] `sensors.jsonl` の行数 = `rgb.mp4` のフレーム数 (= 同期)
- [ ] `imu_high_rate.jsonl` の行数 ≈ 撮影秒数 × 100 (= 100 Hz)
- [ ] `depth/` 配下の PNG 数 = `rgb.mp4` のフレーム数 (= Pro 機の場合)
- [ ] `camera_intrinsics.json` の `fx, fy, cx, cy` が ARFrame の値と一致
- [ ] 全 sensor の `ts` 値の差分が 1 ms 以内で監視できる (= 同期確認の log を残す)

## スコープ外 (= 別タスク)

- 端末側の C2PA 署名 (= 段階 2、 task 09 の延長)
- 非 Pro 機向け depth フォールバック (= scope 外、 LiDAR 無し機は dataset に depth 列が absent になる)
- センサー欠落時の自動 retry / fallback (= 1 セッション内で sensor sampling が落ちたら撮影中断 + user 通知)

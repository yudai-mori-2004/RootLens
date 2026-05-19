# Stera 計測仕様 参照

> 本文書は、 FPV Labs が公開している「Stera」 (= iPhone を用いたエゴセントリック計測フレームワーク) の **計測フォーマット仕様を、 一次資料から再構成したもの** である。 root-lens v0.1.2 の計測層は、 ここに記載された仕様を逐一再現する形で実装する (= task 15 を参照)。
>
> 本文書は引用元を明示する。 出処なしの記述は推測ではなく「未確認」 と明示する。

---

## 1. 概要

Stera は FPV Labs が 2026 年 5 月に公開した、 iPhone 搭載 LiDAR を用いた長時間エゴセントリック計測フレームワーク。 以下から構成される。

- **iOS アプリ** (= Stera Capture): App Store 配布、 ソース非公開
- **撮影中ファイル形式**: MCAP (= ROS 2 / Foxglove が用いる multimodal log コンテナ)
- **リリース形式**: HDF5 + MP4 + PLY + RRD のセット (= データセット配布用)
- **後処理 SDK** (= stera-sdk): Apache 2.0 で GitHub 公開、 Python
- **公開データセット** (= Stera-10M): 200 時間 / 584 セッション / 20 環境、 HuggingFace で配布 (gated)

私たちが Stera を計測層の参照とする理由は 3 点。

1. iPhone (= 私たちと同じハードウェア) を前提とした唯一の研究グレード仕様であること
2. 後処理 SDK が Apache 2.0 で公開されており、 買い手が読み出しツールを無償で入手できること
3. iOS で書き出される MCAP の仕様が、 SDK のソースコードを読むことで完全に再構成できること

---

## 2. 引用元 (= 一次資料)

| ID | 種類 | 出処 | 公開度 |
|---|---|---|---|
| **PAPER** | 論文 | arxiv 2605.05945 (MobileEgo Anywhere) | 完全公開 |
| **SDK** | SDK ソース | `github.com/fpv-labs/stera-sdk` (Apache 2.0) | 完全公開 |
| **HF-CARD** | データセットカード | `huggingface.co/datasets/fpvlabs/stera-10m` README | 完全公開 |
| **HF-DATA** | 実データ | 同上、 1 セッション約 4 GB | gated アクセス (申請承認制) |
| **APP** | iOS アプリ | App Store 配布 (= "FPV Labs", id6756263398) | バイナリのみ、 ソース非公開 |
| **FPV-DOCS** | 公式ドキュメント | `fpvlabs.ai/docs` | **現在 404 (= 未 live)** |

本文書中の各記述は、 上記 ID で出処を示す。

---

## 3. ハードウェア前提

[PAPER §3]

- 端末: iPhone Pro 系 (LiDAR 搭載モデル必須)
- 装着: ヘッドマウント (= ヘルメットなどに固定)
- バッテリー: 外部給電前提 (= 長時間撮影想定)
- 撮影者の操作: 音声コマンド (= "start" / "stop")、 撮影中は画面なし

私たちが採用する変更点 (= task 15 で議論):

- 非 Pro iPhone (LiDAR なし) でも撮影できる経路を別途用意する (= 仕様外の補完。 §8 参照)
- 装着方式は別 task で検討、 本文書のスコープ外

---

## 4. 撮影中の出力形式 (= MCAP)

### 4.1 ファイル全体構成

[SDK: `src/stera/data/mcap/_reader.py`, `_session.py`]

iOS アプリは撮影セッションごとに 1 本の MCAP ファイル (= `.mcap` 拡張子) を書き出す。 MCAP 仕様は `mcap.dev/specification` に従う (= Foxglove が定義する記録コンテナ規格)。

MCAP の各メッセージは以下のフィールドを持つ:

- `channel_id` (uint16): どのトピックに属するか
- `sequence` (uint32): メッセージの通番
- `log_time` (uint64): 記録時刻 (= ナノ秒)
- `publish_time` (uint64): 送信時刻 (= ナノ秒、 通常 log_time と同値)
- `data` (bytes): メッセージ本体 (= 後述のスキーマに従ったバイナリ)

### 4.2 タイムスタンプ規約

[SDK: `src/stera/data/mcap/_decoders.py:11`]

各メッセージ本体には `header.stamp.sec` (uint32) + `header.stamp.nanosec` (uint32) のペアでも時刻が冗長記録される。 これは ROS 1 / ROS 2 の `std_msgs/Header` 形式。

MCAP 全体の時刻基準は **デバイスのモノトニッククロック** (= ARFrame.timestamp と同じ基準)。 セッション内のみ valid、 セッション跨ぎの整合は保証しない (= [PAPER §3.2])。

### 4.3 座標系規約

[PAPER §3.3, SDK: `src/stera/data/mcap/_decoders.py:_quat_to_rot`]

- 世界座標系: ARKit の `worldAlignment = .gravity` を採用 (= 重力を Y 軸負方向に固定、 撮影開始時のデバイス姿勢を基準とする)
- カメラ座標系: ARKit 規約 (= 右手系、 +X 右、 +Y 上、 -Z 前方)
- 回転表現: クォータニオン (x, y, z, w) 順
- 並進表現: メートル単位

### 4.4 トピック一覧

[SDK: `src/stera/data/mcap/_reader.py:19-32`, `_session.py:98-110`]

stera-sdk は MCAP ファイルを開く際、 以下の 6 トピックがすべて非空であることを要求する (= `REFERENCE_TOPICS`)。 1 つでも欠けていれば `check_format=True` の場合は reject される。

**必須トピック:**

| トピック名 | メッセージ型 | サンプリングレート | 出処 |
|---|---|---|---|
| `/camera/rgb/compressed` | `sensor_msgs/CompressedImage` | 15 fps [HF-CARD] | ARFrame.capturedImage を JPEG エンコード |
| `/camera/depth` | `sensor_msgs/Image` | 15 fps (想定) | ARFrame.sceneDepth.depthMap |
| `/camera/camera_info` | `sensor_msgs/CameraInfo` | RGB 1 回 / depth 1 回 | ARFrame.camera.intrinsics |
| `/camera/depth/camera_info` | `sensor_msgs/CameraInfo` | 1 回 | depth 解像度 144×256 [HF-CARD] |
| `/camera/pose` | `geometry_msgs/PoseStamped` | 30 fps (想定) | ARFrame.camera.transform |
| `/camera/tracking_state` | カスタム (= 後述) | 状態変化時 + 30 fps | ARCamera.trackingState |
| `/device/imu` | `sensor_msgs/Imu` | 100 Hz [HF-CARD] | CoreMotion deviceMotion |

**追加トピック (= REFERENCE_TOPICS に含まれるが空でも reject されない):**

| トピック名 | メッセージ型 | レート | 出処 |
|---|---|---|---|
| `/map/mesh` | `visualization_msgs/Marker` (TRIANGLE_LIST) | 低頻度 | ARMeshAnchor の集約 |
| `/map/mesh_cloud` | `sensor_msgs/PointCloud2` | 低頻度 | mesh から派生した頂点クラウド |
| `/map/point_cloud` | `sensor_msgs/PointCloud2` | 低頻度 | シーン再構成由来のポイントクラウド |
| `/trajectory` | `nav_msgs/Path` | セッション終了時 1 回 | 全 pose の履歴 |

### 4.5 各トピックの詳細スキーマ

すべて ROS 1 / ROS 2 標準メッセージ。 ROS msg 定義は `docs.ros.org` で公開されている。 stera-sdk のデコーダ ([SDK: `_decoders.py`]) から、 実際に必要なフィールドを抽出する。

#### 4.5.1 `/camera/rgb/compressed` (sensor_msgs/CompressedImage)

[SDK: `_decoders.py:27`]

```
std_msgs/Header header
  uint32 seq
  time stamp
    uint32 sec
    uint32 nanosec
  string frame_id
string format         # "jpeg" を想定
uint8[] data          # JPEG エンコード済みバイト列
```

実装ノート:

- 解像度: 1280×720 [HF-CARD]
- フレームレート: 15 fps [HF-CARD]
- JPEG 品質: 公開されていない (= [APP] 内部、 我々は 0.8 を初期値とする)
- `frame_id`: 標準 ROS 慣行では `"camera_rgb"` 等。 stera-sdk 内に具体的な値は記載なし

#### 4.5.2 `/camera/depth` (sensor_msgs/Image)

[SDK: `_decoders.py:35`]

```
std_msgs/Header header
uint32 height          # 144 [HF-CARD]
uint32 width           # 256 [HF-CARD]
string encoding        # "32FC1" or "16UC1"
uint8 is_bigendian
uint32 step            # 1 行のバイト数 (= width * sizeof(pixel))
uint8[] data           # ピクセルデータ
```

実装ノート:

- 解像度: 144×256 [HF-CARD]
- エンコーディング:
  - `"32FC1"` (float32, メートル単位): stera-sdk はこれを mm に変換して uint16 化する
  - `"16UC1"` (uint16, mm 単位): そのまま使用
- ARKit の `sceneDepth.depthMap` は float32 メートル → `"32FC1"` で書き出すのが自然

#### 4.5.3 `/camera/camera_info` (sensor_msgs/CameraInfo)

[SDK: `_decoders.py:55`]

```
std_msgs/Header header
uint32 height
uint32 width
string distortion_model    # ARKit は無歪曲想定 → "plumb_bob" or ""
float64[] D                # distortion 係数、 空配列でも可
float64[9] K               # 3x3 intrinsic 行列 (row-major)
float64[9] R               # 3x3 rectification、 単眼なら単位行列
float64[12] P              # 3x4 projection 行列
uint32 binning_x
uint32 binning_y
sensor_msgs/RegionOfInterest roi
  uint32 x_offset
  uint32 y_offset
  uint32 height
  uint32 width
  bool do_rectify
```

実装ノート:

- ARFrame.camera.intrinsics は 3×3 float の `simd_float3x3`。 これを K に row-major で 9 要素として展開
- P は `[K[0:3] | 0; K[3:6] | 0; K[6:9] | 0]` の形 (= 単眼の場合)
- D は空配列で OK (ARKit は内部で歪曲補正済み画像を返す)

#### 4.5.4 `/camera/pose` (geometry_msgs/PoseStamped)

[SDK: `_decoders.py:45`]

```
std_msgs/Header header
geometry_msgs/Pose pose
  geometry_msgs/Point position
    float64 x
    float64 y
    float64 z
  geometry_msgs/Quaternion orientation
    float64 x
    float64 y
    float64 z
    float64 w
```

実装ノート:

- ARFrame.camera.transform は 4×4 simd_float4x4
- position: `[transform.columns.3.x, .y, .z]` (= 並進成分)
- orientation: 3×3 上左部分行列をクォータニオン (x, y, z, w) に変換
- フレームレート: 公開なし。 30 fps を初期値とする (= ARKit が 30/60 fps、 RGB と同じレートで出すのが自然)

#### 4.5.5 `/camera/tracking_state` (カスタム)

[SDK: `_decoders.py:97`]

stera-sdk のデコーダから、 メッセージは以下のフィールドを持つことが分かる:

```
std_msgs/Header header
int32 state             # ARCamera.TrackingState の数値表現
int32 reason            # ARCamera.TrackingState.Reason の数値表現
string state_str        # "normal" / "limited" / "notAvailable"
string reason_str       # "initializing" / "excessiveMotion" / "insufficientFeatures" / "relocalizing" / ""
```

実装ノート:

- ROS 標準メッセージにこの構造はない → 自前のスキーマを MCAP の schema レコードに登録する必要あり
- スキーマ名: 仮 `stera/TrackingState`、 encoding 仮 `ros1msg` (= 実体は ROS 1 msg 形式に揃える)
- 完全スキーマ定義 (= .msg テキスト):

```
Header header
int32 state
int32 reason
string state_str
string reason_str
```

ARKit との対応:

| ARCamera.TrackingState | state (int) | state_str |
|---|---|---|
| `.notAvailable` | 0 | `"notAvailable"` |
| `.limited(.initializing)` | 1 | `"limited"` |
| `.limited(.relocalizing)` | 1 | `"limited"` |
| `.limited(.excessiveMotion)` | 1 | `"limited"` |
| `.limited(.insufficientFeatures)` | 1 | `"limited"` |
| `.normal` | 2 | `"normal"` |

reason_str は state_str が `"limited"` 以外のとき空文字列。

#### 4.5.6 `/device/imu` (sensor_msgs/Imu)

[SDK: `_decoders.py:68`]

```
std_msgs/Header header
geometry_msgs/Quaternion orientation     # 融合済み姿勢
float64[9] orientation_covariance
geometry_msgs/Vector3 angular_velocity   # rad/s (gyro)
float64[9] angular_velocity_covariance
geometry_msgs/Vector3 linear_acceleration # m/s² (accel)
float64[9] linear_acceleration_covariance
```

実装ノート:

- ソース: CoreMotion `CMDeviceMotion`
  - `orientation`: `motion.attitude.quaternion` (CMQuaternion x, y, z, w)
  - `angular_velocity`: `motion.rotationRate` (CMRotationRate x, y, z) rad/s
  - `linear_acceleration`: `motion.userAcceleration` + `motion.gravity` を合成 (= 生加速度)
- レート: 100 Hz [HF-CARD]
- 共分散行列: 公開なし。 ROS 慣行で対角に分散を入れる (= 推定値) か、 不明 (= -1 で埋める) かを選ぶ。 stera-sdk は実値を使わないので **-1 埋めで問題ない** (= [SDK: decode_imu は covariance を読まない])

#### 4.5.7 `/map/mesh` (visualization_msgs/Marker, TRIANGLE_LIST)

[SDK: `_decoders.py:138`]

```
std_msgs/Header header
... (Marker 固有フィールド多数)
int32 type                       # 11 (= TRIANGLE_LIST)
geometry_msgs/Point[] points     # 三角形ごとに 3 点ずつ、 N*3 個
std_msgs/ColorRGBA[] colors      # 任意、 points と同数
```

実装ノート:

- ARMeshAnchor の頂点 + face を TRIANGLE_LIST 形式に展開 (= 各三角形について 3 頂点を points に push)
- 色は任意。 ARMeshClassification を色マッピングして入れる選択肢あり (Stera が実際にどうしているかは未確認)

#### 4.5.8 `/map/point_cloud` (sensor_msgs/PointCloud2)

[SDK: `_decoders.py:108`]

```
std_msgs/Header header
uint32 height            # unorganized なら 1
uint32 width             # 点の数
sensor_msgs/PointField[] fields
  string name            # "x", "y", "z", 任意で "rgb"
  uint32 offset
  uint8 datatype         # 7 = FLOAT32
  uint32 count
bool is_bigendian
uint32 point_step        # 1 点あたりのバイト数
uint32 row_step          # 1 行のバイト数
uint8[] data
bool is_dense
```

実装ノート:

- 必須フィールド: x, y, z (float32)。 任意で rgb (uint32 packed: 0x00RRGGBB)
- ARKit からの点群: シーン再構成または LiDAR raw からの派生

#### 4.5.9 `/trajectory` (nav_msgs/Path)

[SDK: `_decoders.py:152`]

```
std_msgs/Header header
geometry_msgs/PoseStamped[] poses
```

実装ノート:

- セッション終了時に 1 メッセージとして書き出す
- `/camera/pose` の全履歴をそのまま入れる

---

## 5. リリース形式 (= 後処理後のデータセット)

[HF-CARD]

iOS が書き出した MCAP は、 サーバ側の stera-sdk が後処理した後、 以下のファイル群として再配布される。 我々の v0.1.2 計測層のスコープ外だが、 後続フェーズの参照として記録する。

```
<session_id>/
├── rgb.mp4                   # 1280×720 @ 15 fps, H.264, PII (= 顔) 暗号化済
├── annotation.hdf5           # 全 per-frame + sparse アノテーション
├── mesh.ply                  # 部屋メッシュ (~45k vertices)
├── thumbnail.jpg
├── calibrations/             # 校正データ (内訳は HF-DATA で確認要)
├── visualization.rrd         # Rerun フル可視化
└── visualization_2min.rrd    # Rerun 2 分プレビュー
└── _hand_poses.pkl           # WiLoR/HaMeR 出力 (Python pickle、 内部キャッシュと思われる)
└── _segs.pkl                 # セグメンテーション (推測: シーンセグメント)
└── hierarchy.json            # 言語階層 (atomic / episode / sub-goal / session)
```

### 5.1 annotation.hdf5 の中身 (= 概要のみ公開)

[HF-CARD]

- RGB フレーム (= ~10M total、 動画とは別に画像配列としても格納されている可能性)
- LiDAR depth (= 144×256, uint16 mm, per frame)
- ARKit 6-DoF pose (= rotation, translation, timestamp per frame)
- IMU (= 100 Hz: acceleration, angular velocity, orientation quaternion)
- Two-hand mocap (= 21-joint MANO、 グローバル座標系)
- 階層的言語キャプション (= session / sub-goal / episode / atomic)

**完全な HDF5 スキーマ (group/dataset パス、 dtype、 shape) は公開されていない。** 実データを 1 セッション落として `h5dump` で確認する必要がある (= task 15 のサブタスク)。

---

## 6. 後処理パイプライン (= stera-sdk が担当する部分)

[SDK: `src/stera/models/`, `src/stera/processing/`, `src/stera/eval/`]

サーバ側で MCAP → リリース形式に変換する際、 以下のモデルが適用される。 stera-sdk は各モデルを swappable に提供する。

| 処理 | モデル | パス | 出力 |
|---|---|---|---|
| 顔ぼかし | EgoBlur, MediaPipe Face, RetinaFace | `src/stera/models/{egoblur, mediapipe_face, retinaface}/` | RGB の顔領域を blur 済み |
| 手姿勢 (= 2D / 3D) | HaMeR, WiLoR, MediaPipe Hands | `src/stera/models/{hamer, wilor, mediapipe}/` | 21 関節 MANO (3D) |
| 骨格 | Skeleton (= 詳細未確認) | `src/stera/models/skeleton/` | 上半身関節 |
| Mesh 精緻化 | Mesh refiner | `src/stera/processing/mesh.py` | 高密度クラウド + 三角形 |
| 品質評価 | EvaluateConfig | `src/stera/eval/` | 健康スコア / メトリクス |

### 6.1 品質評価の閾値

[SDK: `src/stera/eval/config.py`]

stera-sdk は録画の「健康スコア」 を 100 点満点から減点方式で算出する。 root-lens 側で realtime feedback に流用する場合の基準値。

| メトリック | good | ok | weight |
|---|---|---|---|
| 1+ hand 出現率 | ≥ 40 % | ≥ 15 % | 0.05 |
| 2 hand 出現率 | ≥ 30 % | ≥ 10 % | 0.075 |
| any hand 出現率 | ≥ 70 % | ≥ 30 % | 0.15 |
| depth valid % | ≥ 80 % | ≥ 50 % | 0.3 |
| RGB/depth/IMU 同期 % | ≥ 90 % | ≥ 70 % | 0.1 |
| IMU gravity の重力定数からのズレ | ≤ 0.5 m/s² | — | — |
| RGB frame gap | 0 個 | — | 1 / gap |

---

## 7. 我々の採用範囲

root-lens v0.1.2 task 15 (= 計測ベースライン) では、 以下を完全再現する:

- [§4] MCAP 出力 (= 必須 6 トピック + 追加 4 トピック、 すべて Stera と同名 / 同スキーマ)
- [§4.3] 座標系規約 (= ARKit gravity-aligned world frame)
- [§4.2] タイムスタンプ規約 (= ARFrame.timestamp を基準にした ns 単位)
- [§3] ハードウェア前提のうち LiDAR 必須経路 (= Pro 機向け)

採用しない / 後フェーズに回す:

- [§5] リリース形式 (HDF5 + PLY + RRD)
- [§6] サーバ側後処理 (= 手姿勢、 顔ぼかし、 品質評価)
- [§3] 非 Pro 機経路 (= LiDAR なし時のフォールバック仕様)

これにより、 撮影完了時点で出力される MCAP ファイルを stera-sdk の `MCAPReader` に渡せば、 そのまま中身が読める状態になる。

---

## 8. 仕様自由度 (= 我々が決めてよい範囲)

以下は Stera 側で値が公開・固定されていない箇所で、 我々が任意に選定できる。 stera-sdk のデコーダは値そのものを検証しないため、 ROS msg のフィールド名と型さえ合っていれば通る。

| 項目 | 我々の初期値 | 根拠 |
|---|---|---|
| JPEG エンコード品質 | 0.8 | デコーダは品質値を検証しない。 0.7-0.9 のレンジで実用上問題なし |
| `/camera/pose` のレート | 30 fps | ARFrame は通常 30/60 fps。 RGB と同じレートで揃えると同期が単純 |
| `/camera/depth` のレート | 15 fps | RGB と同じレートに揃える ([HF-CARD] の 15 fps と一致) |
| `frame_id` 文字列 | `"camera_rgb"`, `"camera_depth"`, `"imu"`, `"world"` | ROS 慣行に従う命名。 stera-sdk は frame_id を可視化以外で使わない |
| `/camera/tracking_state` のスキーマ名 | `stera/TrackingState` | デコーダ ([SDK: `_decoders.py:97`]) はフィールド名で参照するため、 schema 名は自由 |
| `/map/mesh_cloud` と `/map/point_cloud` の使い分け | `/map/point_cloud` のみ書き出す | stera-sdk は両方読めるが、 REFERENCE_TOPICS では `/map/point_cloud` で十分 |

リリース形式 (= §5 の HDF5 + PLY + RRD) は task 15 のスコープ外。 後続フェーズで実データから観察して確定する。

---

## 9. 参考リンク

- 論文: <https://arxiv.org/abs/2605.05945>
- SDK: <https://github.com/fpv-labs/stera-sdk>
- データセット: <https://huggingface.co/datasets/fpvlabs/stera-10m>
- iOS アプリ: <https://apps.apple.com/us/app/fpv-labs/id6756263398>
- 可視化: <https://platform.fpvlabs.ai/dataset/stera-10m/viz>
- MCAP 規格: <https://mcap.dev/specification>
- MCAP Swift 実装: <https://github.com/foxglove/mcap/tree/main/swift>
- ROS sensor_msgs: <https://docs.ros.org/en/api/sensor_msgs/html/>
- ROS geometry_msgs: <https://docs.ros.org/en/api/geometry_msgs/html/>
- ROS nav_msgs: <https://docs.ros.org/en/api/nav_msgs/html/>
- ROS visualization_msgs: <https://docs.ros.org/en/api/visualization_msgs/html/>

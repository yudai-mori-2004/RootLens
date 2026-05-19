# Task 17: LeRobotDataset v3 ベース配布 + 3 層パイプライン

## 目的

RootLens の出力を、 そのまま HuggingFace Hub にアップロード可能な品質の **LeRobotDataset v3.0** に揃える。 LeRobot は HuggingFace 公式が維持する ego-centric / robotics 領域の事実上の標準形式で、 schema validated。 設計根拠は [LeRobotDataset v3.md](LeRobotDataset%20v3.md) を参照。

「独自形式になる」 「特定 vendor 互換に縛られる」 の両方を避け、 業界で広く使われている既存形式に正面から合わせる。

## 3 層パイプライン

処理は 3 つの独立した パイプラインに分かれる。 各パイプラインは入力 (= データへのリンク) を受け取り、 出力 (= 別のデータへのリンク) を返す純粋な関数。 互いに疎結合。

```
┌── Pipeline 1: 撮影 ─────────────────────────────────────────────────┐
│  端末で完結。 ARKit で同期した RGB + sensor stream を記録、         │
│  ストレージにアップロードする。                                       │
│                                                                       │
│  Output: 生データへのリンク (= rgb.mp4 + sensors.jsonl)               │
└─────────────────────────────────────────────────────────────────────┘

┌── Pipeline 2: 品質評価 ─────────────────────────────────────────────┐
│  Input: 生データへのリンク                                            │
│  処理:                                                                 │
│    a. 顔ぼかし (= YuNet)                                             │
│    b. C2PA サーバ署名 「署名 S」 (= SPECS §2.10 段階 1)              │
│    c. quality score 算出 (= SPECS §6.3 の閾値)                        │
│    d. Title Protocol register → Root NFT 発行                        │
│  Output: blurred-rgb.mp4 へのリンク + quality_score + root_asset_id  │
└─────────────────────────────────────────────────────────────────────┘

┌── Pipeline 3: 販売データ整形 ───────────────────────────────────────┐
│  Input: 生データへのリンク + root_asset_id                            │
│  処理:                                                                 │
│    a. WiLoR で hand pose 抽出 (= MANO pose + shape + 21 kp 3D)       │
│    b. sensors を per-frame parquet column に組み立て                 │
│    c. RGB 映像を LeRobot v3 の videos/ 配下に配置                    │
│    d. meta/info.json / stats.json / tasks.jsonl / episodes/* 生成    │
│  Output: LeRobot v3 dataset へのリンク (= meta/ data/ videos/)        │
└─────────────────────────────────────────────────────────────────────┘
```

Pipeline 2 と 3 は同じ Modal app 上の独立した関数として実装する。 入力に渡されるデータリンクは現時点では実装側のストレージ形式 (R2 / S3 / 他) を問わない。

## 配布物の構造 (= Pipeline 3 の出力)

LeRobotDataset v3.0 公式仕様に準拠。

```
<dataset_root>/
├── meta/
│   ├── info.json
│   ├── stats.json
│   ├── tasks.jsonl
│   └── episodes/
│       └── chunk-000/
│           └── file-000.parquet
├── data/
│   └── chunk-000/
│       └── file-000.parquet
└── videos/
    └── observation.images.ego_cam/
        └── chunk-000/
            └── file-000.mp4
```

`<dataset_root>` は実装で決まる (= 多くは Root NFT asset id 等で命名)。 1 dataset = 1 episode (= 1 撮影クリップ)。 複数 clip を集約した dataset は別途設計する。

## LeRobotDataset v3 schema

per-frame の列。 LeRobot の慣行に従い、 `observation.*` / `action` / `task_index` / `timestamp` 等の予約名に従う。

| column | dtype | shape | 内容 |
|---|---|---|---|
| `timestamp` | float32 | scalar | 撮影開始からの秒 |
| `frame_index` | int64 | scalar | エピソード内 frame index |
| `episode_index` | int64 | scalar | 常に 0 (= 1-episode dataset) |
| `index` | int64 | scalar | global index |
| `task_index` | int64 | scalar | tasks.jsonl の index |
| `observation.images.ego_cam` | video frame ref | [3, 720, 1280] | videos/ 配下の MP4 n フレーム目 (= 顔ぼかし + C2PA 「署名 S」 入り) |
| `observation.state` | float32 | [7] | カメラ 6-DoF (xyz + quaternion xyzw)、 ARKit world 座標 |
| `observation.depth` | uint16 | [144, 256] | LiDAR depth (mm)。 非 Pro 機では absent |
| `observation.imu_orientation` | float32 | [4] | quaternion xyzw |
| `observation.imu_angular_velocity` | float32 | [3] | rad/s |
| `observation.imu_linear_acceleration` | float32 | [3] | m/s² |
| `observation.tracking_state` | int8 | scalar | 0=notAvailable / 1=limited / 2=normal |
| `observation.hand_pose_mano` | float32 | [2, 48] | 両手 MANO pose (axis-angle、 WiLoR 出力) |
| `observation.hand_shape_mano` | float32 | [2, 10] | 両手 MANO shape |
| `observation.hand_keypoints_3d` | float32 | [2, 21, 3] | 両手 21 keypoint 3D 位置 (= camera 座標、 world 座標は post 計算可) |
| `observation.hand_present` | bool | [2] | 検出 flag [left, right] |
| `action` | float32 | [14] | 両手手首 6-DoF (= xyz + quat × 2)、 制御信号として最小 |

`action = 両手手首 6-DoF` の選択は EgoMimic と一致。 MANO pose / shape / keypoint は `observation.*` に保持し、 高度な VLA はそこを使う。 これは EgoVLA の design と整合。

## info.json の RootLens 拡張フィールド

LeRobot v3 標準の `features` / `fps` / `total_episodes` / `data_path` / `video_path` 等に加え、 `rootlens` キーで以下を持つ:

```json
{
  "rootlens": {
    "root_nft_asset_id": "<TP cNFT pubkey>",
    "content_hash": "<sha256 hex of blurred.mp4>",
    "signed_json_uri": "<TP storage URI>",
    "c2pa_signer_cert_chain_sha256": "<...>",
    "pipeline_version": "v0.1.2",
    "captured_at": "<ISO 8601>"
  }
}
```

LeRobot v3 spec は info.json への追加メタデータを禁じない。 ここに署名情報を焼くことで、 dataset 単体で provenance を辿れる。

## ハンドポーズ推定 (= Pipeline 3 中核)

WiLoR を採用。 理由は [LeRobotDataset v3.md §6](LeRobotDataset%20v3.md) 参照。 要点:

- 内蔵 YOLO 検出 + transformer reconstruction、 self-contained で運用が軽い
- MANO pose / shape / 21 keypoint 3D を 1 推論で出す
- 商用利用された ego-centric 学習で EgoVLA / EgoMimic と同じ役割を担う
- FreiHAND / HO3D ベンチで SOTA、 ego 視点の歪み・オクルージョンには下記の前処理で対応

Pipeline 3 では:
1. RGB の各 frame を WiLoR に入れる (= 内蔵 YOLO で手領域を crop)
2. MANO pose 48 + shape 10 + 21 keypoint 3D を取り出す
3. weak perspective camera model の出力スケールを camera intrinsics で metric 3D に換算 (= 実装最大リスク、 [LeRobotDataset v3.md §8](LeRobotDataset%20v3.md) 参照)
4. ARKit camera pose と組み合わせて 必要なら world 座標も計算

## Modal app 構成

`server/modal/` 配下に 2 つの関数を持つ 1 app:

| 関数 | 用途 | resource |
|---|---|---|
| `evaluate_clip` | Pipeline 2 (= YuNet + C2PA + quality + TP register) | CPU 4 / 2 GB |
| `bundle_dataset` | Pipeline 3 (= WiLoR + LeRobot v3 構築) | GPU A10G / 16 GB |

両関数とも 入力に data link を取る純粋関数。

## 端末出力フォーマット (= Pipeline 1)

iOS アプリが 1 セッションごとに以下を出力:

| ファイル | 内容 | 形式 | rate |
|---|---|---|---|
| `rgb.mp4` | RGB 映像 | H.264 (AVAssetWriter) | 30 fps |
| `sensors.jsonl` | per-frame の pose / IMU / tracking_state | JSON Lines (1 行 = 1 frame の dict) | 30 fps (= 映像と同期) |
| `imu_high_rate.jsonl` | 100 Hz IMU (= sensors.jsonl とは別 stream) | JSON Lines | 100 Hz |
| `camera_intrinsics.json` | fx, fy, cx, cy + RGB / depth 解像度 | JSON (= セッション 1 回) | - |
| `depth/{frame_id}.png` | LiDAR depth (= Pro 機のみ) | 16-bit PNG | 30 fps |

時刻基準は `ARFrame.timestamp`、 全 stream で共通。

## R2 / ストレージ レイアウト

ストレージ実装は 3 つの prefix に分割:

| 用途 | prefix | 生成者 |
|---|---|---|
| 生データ | `raw/<content_hash>/` | Pipeline 1 (= 端末) |
| 中間ぼかし映像 | `blurred/<content_hash>/blurred.mp4` | Pipeline 2 |
| 配布 dataset | `datasets/<root_asset_id>/` | Pipeline 3 |

具体的な bucket 名 / プロバイダは実装側で決める (= 本 task は logical layout のみ規定)。

## サーバ コードの新構成

| ファイル | 役割 |
|---|---|
| `server/modal/blur.py` | Pipeline 2 の関数 (= `evaluate_clip`)、 現在の blur 処理を rename + 統合 |
| `server/modal/bundle.py` | Pipeline 3 の関数 (= `bundle_dataset`)、 新規 |
| `server/modal/models/face_detection_yunet_2023mar.onnx` | YuNet weight (既存) |
| `server/lib/modal.ts` | `callEvaluate` / `callBundle` 2 つの TypeScript wrapper |
| `server/workflow/process-clip.ts` | Pipeline 2 の呼出のみ (= Pipeline 3 は別経路で起動) |

`server/modal/synthesize.py` は廃止 (= 旧 MCAP 合成路は LeRobot v3 に置換)。 `server/lib/r2-keys.ts` の `deliveryMcapKey` は `datasetPrefix` に置換。

## 旧 MCAP 合成路の撤去

旧 spec で 「Stera 互換 MCAP 合成」 と呼んでいたサーバ側ステップは Pipeline 3 (= LeRobot v3 bundle) に置換される。 関連 identifier (= `delivery-mcap`、 `synthesize-clip`、 `mcap-synthesize`) は サーバコードからも撤去。 paper / repo の参考引用としての言及は保持して良い。

サーバコード側の影響範囲 (= rename / 削除):

- `server/modal/synthesize.py` 削除
- `server/modal/bundle.py` 新設 (= Pipeline 3 関数)
- `server/lib/modal.ts` の `callSynthesize` → `callBundle`
- `server/lib/r2-keys.ts` の `deliveryMcapKey` → `datasetPrefix`
- `server/workflow/process-clip.ts` の step 名 `mcap-synthesize` → `bundle`
- `server/db/schema.ts` の `delivery_mcap_key` カラム → `dataset_prefix` (= drizzle migration 必要)
- `server/shared/api-types.ts` / `server/lib/mapper.ts` 上記に追随

## 成功条件

- [ ] Pipeline 1: 端末出力に sensors.jsonl + imu_high_rate.jsonl + camera_intrinsics.json + depth/* (Pro 機) が rgb.mp4 と同期して並ぶ
- [ ] Pipeline 2: evaluate_clip 関数が 生データリンクを引数に取り、 blurred.mp4 リンク + quality score + root_asset_id を返す
- [ ] Pipeline 3: bundle_dataset 関数が 生データリンク + root_asset_id を引数に取り、 LeRobot v3 dataset リンクを返す
- [ ] LeRobotDataset v3 spec に schema validation が通る (= `LeRobotDataset(<link>)` で error 無く load 可能)
- [ ] `dataset.push_to_hub()` の dry run が通る
- [ ] サンプル frame で `observation.images.ego_cam` が顔ぼかし済、 `observation.hand_pose_mano` が WiLoR 出力、 `action` が両手手首 6-DoF
- [ ] spec / コードから cleanup 対象表現がゼロ
- [ ] 配布 dataset 単体で provenance (= root_asset_id、 content_hash、 cert chain) が info.json から辿れる

## 参考

- [LeRobotDataset v3.md (= 一次資料 + 事実整理)](LeRobotDataset%20v3.md)
- [LeRobotDataset v3.0 spec](https://huggingface.co/docs/lerobot/en/lerobot-dataset-v3)
- [LeRobot GitHub](https://github.com/huggingface/lerobot)
- [WiLoR paper / repo](https://github.com/rolpotamias/WiLoR)
- [EgoVLA (= action / observation 分離 design 参照)](https://rchalyang.github.io/EgoVLA/)
- [EgoMimic (= action = wrist 6-DoF の precedent)](https://arxiv.org/abs/2410.24221)

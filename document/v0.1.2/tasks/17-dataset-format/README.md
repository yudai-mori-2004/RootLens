# Task 17: LeRobotDataset v3 ベース配布 + 3 層パイプライン

## 目的

RootLens の出力を、 そのまま HuggingFace Hub にアップロード可能な品質の **LeRobotDataset v3.0** に揃える。 LeRobot は HuggingFace 公式が維持する ego-centric / robotics 領域の事実上の標準形式で、 schema validated。 設計根拠は [LeRobotDataset v3.md](LeRobotDataset%20v3.md) を参照。

「独自形式になる」 「特定 vendor 互換に縛られる」 の両方を避け、 業界で広く使われている既存形式に正面から合わせる。

## 3 層パイプライン

処理は 3 つの独立した パイプラインに分かれる。 各パイプラインは入力 (= データへのリンク) を受け取り、 出力 (= 別のデータへのリンク) を返す純粋な関数。 互いに疎結合。

```
┌── Pipeline 1: 撮影 + プライバシー ──────────────────────────────────┐
│  端末で完結。 ARKit で同期した RGB + sensor stream を記録、         │
│  Apple Vision (VNDetectFaceRectangles) で顔ぼかしを適用、          │
│  ぼかし済みデータをストレージにアップロードする。                     │
│                                                                       │
│  Output: ぼかし済みデータへのリンク (= blurred.mp4 + sensors.jsonl)   │
└─────────────────────────────────────────────────────────────────────┘

┌── Pipeline 2: 品質評価 ─────────────────────────────────────────────┐
│  Input: ぼかし済みデータへのリンク                                    │
│  処理:                                                                 │
│    a. C2PA サーバ署名 「署名 S」 (= SPECS §2.10 段階 1)              │
│    b. quality score 算出 (= SPECS §6.3 の閾値)                        │
│    c. Title Protocol register → Root NFT 発行                        │
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
| `evaluate_clip` | Pipeline 2 (= C2PA + quality + TP register) | CPU 4 / 2 GB |
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

## 成功条件 (= 2026-05-20 達成)

- [x] Pipeline 1: 端末出力に sensors.jsonl + imu_high_rate.jsonl + camera_intrinsics.json + depth/* (Pro 機) が rgb.mp4 と同期して並ぶ
- [x] Pipeline 2: blur Modal 関数が 生データリンクを引数に取り、 blurred.mp4 リンク + quality score + root_asset_id を返す
- [x] Pipeline 3: bundle_dataset 関数が 生データリンク + root_asset_id を引数に取り、 LeRobot v3 dataset リンクを返す
- [x] LeRobotDataset v3 schema 構造が validate される (= meta/info.json + meta/tasks.jsonl + meta/episodes/* + data/* + videos/* が揃う、 parquet schema が features 定義と一致)
- [x] サンプル frame で `observation.images.ego_cam` が顔ぼかし済 H.264 + C2PA 「署名 S」 入り、 `observation.hand_keypoints_3d` が WiLoR 検出値 (= 全 504 frame で両手検出 100%、 21 joints 物理的に妥当)、 `action` が両手手首 6-DoF (= 現状 wrist は MANO canonical 空間)
- [x] spec / コードから cleanup 対象表現がゼロ
- [x] 配布 dataset 単体で provenance (= root_asset_id、 content_hash、 pipeline_version) が info.json `rootlens.*` から辿れる

実機 e2e 検証 (2026-05-20): iPhone 12 で 8.4 秒撮影 → 4 ファイル並走 upload (= rgb.mp4 6.4MB + sensors.jsonl 387KB + imu_high_rate.jsonl 250KB + camera_intrinsics.json 278B) → Pipeline 2 で blurred 2.3MB + quality 75 + Root NFT 発行 (`0xe3bc0382...`) → ステーキング → Pipeline 3 (A10G, 97 秒) で LeRobot v3 dataset 完成 (= datasets/0xe3bc0382.../)。 parquet の `observation.state` は ARKit world-aligned 6-DoF camera pose で埋まり、 `observation.tracking_state` 全 504 frame `normal`、 IMU は重力 ≈ 1g 検証済。

## lerobot v0.5.1 互換性修正 (= 2026-05-21 達成)

LP サンプル dataset (48 episodes, 38,059 frames) を `lerobot.datasets.lerobot_dataset.LeRobotDataset` で実読み込みし、 不整合を全て修正した。

### 発見した問題と修正

1. **path テンプレ変数名の不一致**: info.json の `data_path` / `video_path` に `{episode_chunk}` / `{episode_index}` を使用していたが、 lerobot v0.5.1 は `{chunk_index}` / `{file_index}` を要求する (`dataset_metadata.py:243,269`)。 全パイプライン (`build_lp_sample.py`, `bundle.py`) + 既存 dataset の info.json を修正。

2. **DEFAULT_FEATURES 欠落**: lerobot の `get_hf_features_from_features()` は info.json の `features` dict から HF features を構築する。 `timestamp`, `frame_index`, `episode_index`, `index`, `task_index` の 5 フィールドが info.json に未宣言だったため、 parquet 読み込み時に column mismatch が起きた。

3. **`meta/tasks.parquet` の欠落**: lerobot v0.5.1 は `meta/tasks.jsonl` ではなく `meta/tasks.parquet` を読む。 jsonl と parquet の両方を生成するように修正。

4. **episodes parquet のカラム不足**: lerobot v0.5.1 は `data/chunk_index`, `data/file_index`, `dataset_from_index`, `dataset_to_index`, `videos/{key}/chunk_index`, `videos/{key}/file_index`, `videos/{key}/from_timestamp`, `videos/{key}/to_timestamp` を要求する。 全て追加。

5. **parquet の Arrow 型不一致**: pyarrow の `fixed_size_list` で書いた多次元配列を HF datasets が `Array2D` / `Array3D` extension type として読めなかった。 `datasets.Dataset.from_dict()` + `Features` 定義で書き直し。

6. **`observation.tracking_state` のスカラー/リスト不一致**: info.json で `shape: [1]` と宣言すると lerobot はスカラー `Value` に変換する (`feature_utils.py:54`)。 parquet 側を `Sequence(int8, length=1)` ではなくスカラー `Value("int8")` に修正。

7. **stats.json が空**: `build_lp_sample.py` と `bundle.py` の両方で `{}` を出力していた。 全 feature の min/max/mean/std を numpy で計算して埋めるように修正。

8. **データ整合性の問題**: codec 表記が H.265 だったが実際は H.264 (ffprobe で確認)。 task 数が 225 だったが episode-level task を除外すると 188。 スペルミス修正 ("make greentea" 等)。

### 修正範囲

| ファイル | 修正内容 |
|---|---|
| `server/scripts/build_lp_sample.py` | path テンプレ、 DEFAULT_FEATURES、 tasks.parquet、 episodes カラム、 HF datasets 型、 stats 計算 |
| `server/scripts/add_phase_labels.py` | tasks.parquet 生成追加 |
| `server/modal/bundle.py` | 上記全て + tracking_state スカラー化 + Modal image に datasets/pandas 追加 |
| `web/public/lp/sample/dataset/meta/info.json` | path テンプレ + DEFAULT_FEATURES |
| `web/public/lp/sample/dataset/meta/stats.json` | 空 → 実値 |
| `web/public/lp/sample/dataset/meta/tasks.parquet` | 新規生成 |
| `web/public/lp/sample/dataset/meta/tasks.jsonl` | episode-level task 除去、 スペル修正 |
| `web/public/lp/sample/dataset/data/chunk-000/file-000.parquet` | HF datasets 型で再構築 + task_index 振り直し |
| `web/public/lp/sample/dataset/meta/episodes/chunk-000/file-000.parquet` | 必須カラム追加 |
| `web/public/lp/sample/dataset/README.md` | codec/size/labels 修正 |
| `web/components/lp/SamplePage.tsx` | codec/size/labels 修正 |
| `web/messages/{en,ja}.json` | 同上 |

### 検証結果

```python
from lerobot.datasets.lerobot_dataset import LeRobotDataset
ds = LeRobotDataset(repo_id='rootlens/sample-v0.1', root='...', download_videos=False)
# 48 episodes, 38059 frames, 188 tasks, fps=30.0
# 全 feature の shape/dtype が info.json 宣言と一致
# frame 0, 1000, 20000, 38058 にアクセスして値を確認済み
```

bundle.py の出力も同様に合成データ (3 episodes, sensor + IMU + hand pose) で検証し、 lerobot v0.5.1 で読み込み成功を確認。

## 出力品質の現状 (= bundler_version `v1-wilor-mano`)

WiLoR-mini の output から以下を per-frame で抽出済:

- `observation.hand_pose_mano` [2, 48]: `global_orient` (3) + `hand_pose` (15×3=45) concat、 axis-angle
- `observation.hand_keypoints_3d` [2, 21, 3]: `pred_keypoints_3d`、 MANO canonical (= hand-local) 空間
- `action` [14]: camera-space wrist 6-DoF = `pred_cam_t_full` (位置) + `global_orient` を quat 変換 (回転)、 両手分
- `observation.hand_present` [2]: detection flag

MANO shape (betas) は WiLoR-mini が exposed していない (= GitHub source [`wilor_hand_pose3d_estimation_pipeline.py`](https://github.com/warmshao/WiLoR-mini/blob/main/wilor_mini/pipelines/wilor_hand_pose3d_estimation_pipeline.py) で確認済)。 そのため `observation.hand_shape_mano [2, 10]` は zeros で出す。 MANO 規約で β=0 は neutral hand mean shape を意味するため、 「shape を推定しない (= 中立形状を仮定)」 の明示シグナルとして妥当。

## さらに先 (= schema 変更を要するもの)

これらは parquet 列を増やすので、 互換性壊さない時期に判断:

- 別 column `observation.hand_vertices` [2, 778, 3] で MANO mesh を保持 (= 大幅サイズ増のため default off の予定)
- 100 Hz IMU の RGB-非同期 stream を別 parquet として並走 (= 現在は `imu_high_rate.jsonl` のサイドカーで配布、 buyer 側で必要に応じて parquet 変換)

## 参考

- [LeRobotDataset v3.md (= 一次資料 + 事実整理)](LeRobotDataset%20v3.md)
- [LeRobotDataset v3.0 spec](https://huggingface.co/docs/lerobot/en/lerobot-dataset-v3)
- [LeRobot GitHub](https://github.com/huggingface/lerobot)
- [WiLoR paper / repo](https://github.com/rolpotamias/WiLoR)
- [EgoVLA (= action / observation 分離 design 参照)](https://rchalyang.github.io/EgoVLA/)
- [EgoMimic (= action = wrist 6-DoF の precedent)](https://arxiv.org/abs/2410.24221)

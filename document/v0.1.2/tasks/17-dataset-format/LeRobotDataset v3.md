# エゴセントリック・スマホデータ → LeRobotDataset v3 変換パイプライン仕様書

> **目的**: スマホ（iOS ARKit）でネック/ヘッドマウント撮影したエゴセントリック映像+センサーデータを、
> HuggingFace にそのまま push できる LeRobotDataset v3.0 形式に変換するパイプラインの実装仕様。
>
> **情報源の信頼度ルール**: 各項目に `[出典]` を付記。公式ドキュメント/論文/GitHubコードから確認した事実のみ記載。
> 推測・補間が含まれる箇所は `⚠️ 要検証` と明記。

---

## 1. ゴール: 完成形のファイル構造

LeRobotDataset v3.0 公式仕様に準拠。

```
dataset/
├── meta/
│   ├── info.json                          # schema定義 (features, shapes, dtypes, fps)
│   ├── stats.json                         # 全featureの mean/std/min/max
│   ├── tasks.jsonl                        # {"task_index": 0, "task": "pick up mug"}
│   └── episodes/
│       └── chunk-000/
│           └── file-000.parquet           # episode metadata (lengths, tasks, offsets)
├── data/
│   └── chunk-000/
│       └── file-000.parquet               # フレーム単位の tabular data (複数episode結合)
└── videos/
    └── observation.images.ego_cam/
        └── chunk-000/
            └── file-000.mp4               # H.264 RGB映像 (複数episode結合)
```

[出典: HuggingFace公式 lerobot-dataset-v3.mdx, huggingface/lerobot リポジトリ main branch]

---

## 2. 1フレームあたりのデータ構造

```python
frame = {
    # --- 映像 (MP4から自動デコード) ---
    "observation.images.ego_cam": tensor([3, H, W]),  # RGB, uint8

    # --- カメラポーズ (ARKit VIO) ---
    "observation.state": tensor([7]),
    #   [x, y, z, qx, qy, qz, qw]  (位置3 + quaternion4, float32)
    #   座標系: ARKit world座標

    # --- ハンドポーズ → action ---
    "action": tensor([N]),
    #   Nの選択は §5 参照。用途に応じて設計が分岐する。

    # --- 自動付与されるインデックス ---
    "timestamp": float,
    "episode_index": int,
    "task_index": int,
}
```

### observation.state の中身

| index | 意味 | 単位 | 取得元 |
|-------|------|------|--------|
| 0-2 | カメラ位置 (x, y, z) | メートル | ARFrame.camera.transform の translation 列 |
| 3-6 | カメラ姿勢 (qx, qy, qz, qw) | quaternion | ARFrame.camera.transform の rotation → quaternion |

[出典: Apple ARKit ドキュメント `ARCamera.transform` は 4×4 column-major matrix]

⚠️ 要検証: ARKit の quaternion 規約。`simd_quatf` は (ix, iy, iz, r) 順 = (qx, qy, qz, qw)。
scipy や PyTorch3D は (qx, qy, qz, qw) を期待するため、そのまま使える見込みだが、
`ARFrame.camera.transform` からの抽出コードは実機で quaternion の符号・順序を要確認。

---

## 3. 端末側で記録すべき生データ

iOS アプリが 1 セッション（= 1 recording）ごとに出力するファイル:

| ファイル | 内容 | 形式 | fps / rate |
|----------|------|------|------------|
| `rgb.mp4` | エゴセントリック RGB 映像 | H.264, AVAssetWriter | 30 fps |
| `poses.jsonl` | フレームごとのカメラ 4×4 transform | JSON Lines, 1行/frame | 30 fps (映像と同期) |
| `imu.jsonl` | 加速度 (3) + 角速度 (3) + timestamp | JSON Lines | 100 Hz |
| `camera_intrinsics.json` | fx, fy, cx, cy, 歪み係数 | JSON, セッションに1つ | - |
| `depth/` (optional) | LiDAR 深度マップ | 16bit PNG per frame, or 別MP4 | 30 fps |

**同期方法**: `ARFrame.timestamp` (= `CMTime` ベースの秒数, Double) を全ストリームの共通タイムスタンプとする。
`rgb.mp4` のフレームには `CMSampleBuffer.presentationTimeStamp` で同じ値を埋め込む。

[出典: ARKit の ARFrame.timestamp は device boot からの経過秒。
MobileEgo Anywhere 論文 §3 "ARKit to capture synchronized RGBD streams, providing 6-DoF camera poses"]

---

## 4. サーバー側パイプライン (後処理)

```
入力: rgb.mp4 + poses.jsonl + imu.jsonl + camera_intrinsics.json
                         ↓
    ┌─────────────────────────────────────────────────────┐
    │  Step 1: 映像前処理                                 │
    │    - (optional) undistort: opencv-python             │
    │      cv2.undistort(frame, K, dist_coeffs)           │
    │    - face blur: YuNet or mediapipe FaceDetection     │
    │    - 映像はそのまま LeRobot の videos/ に配置        │
    │      (再エンコード不要、元 MP4 を chunk に結合)      │
    ├─────────────────────────────────────────────────────┤
    │  Step 2: ハンドポーズ推定                            │
    │    - 入力: rgb.mp4 のフレーム群                      │
    │    - ライブラリ: HaMeR or WiLoR (§6 参照)           │
    │    - 出力: フレームごとの MANO パラメータ or          │
    │            21 キーポイント 3D 座標 (カメラ座標系)     │
    ├─────────────────────────────────────────────────────┤
    │  Step 3: 座標変換                                    │
    │    - ハンドポーズ (カメラ座標系)                      │
    │      → poses.jsonl のカメラ transform で             │
    │      → ワールド座標系に変換                          │
    │    - scipy.spatial.transform.Rotation 使用           │
    ├─────────────────────────────────────────────────────┤
    │  Step 4: エピソード分割 + タスクラベル生成            │
    │    - 方法: VLM にサンプルフレーム列を入力して         │
    │      アトミックアクションの区間と言語記述を生成       │
    │    - or: 手動で開始/終了フレームを指定               │
    │    - 出力: episodes 配列 [{start, end, task_text}]   │
    ├─────────────────────────────────────────────────────┤
    │  Step 5: LeRobotDataset v3 書き出し                  │
    │    - lerobot >= 0.4.0 の Python API 使用             │
    │    - create → add_frame → save_episode → finalize   │
    │    - push_to_hub で HuggingFace に直接 upload        │
    └─────────────────────────────────────────────────────┘
```

---

## 5. action フィールドの設計選択肢

ここは「何のロボットで何をしたいか」で変わる。事実として確認できる先行研究の選択:

### 選択肢 A: 21 キーポイント × 両手の 3D 位置 (ワールド座標)

- 次元: 21 × 3 × 2手 = **126** (片手のみなら 63)
- 用途: 巧緻操作の学習
- 先行例: EgoDex (Apple, 2025), OpenEgo

### 選択肢 B: 手首の 6-DoF のみ

- 次元: (xyz + quaternion) × 2手 = **14** (片手なら 7)
- 用途: ピック＆プレイス等のアーム制御
- 先行例: EgoMimic (action を手首ポーズに集約)

### 選択肢 C: MANO ポーズパラメータ

- MANO の全ポーズパラメータ: **片手 48 次元** (16関節 × 3 axis-angle)
  - 内訳: global rotation 3 + 15 finger joints × 3 = 48
- MANO の形状パラメータ: **片手 10 次元** (β, PCA 係数)
- 両手なら: ポーズのみ 96, ポーズ+形状 116
- 用途: VLA 事前学習 (手の形状まで含む情報が必要な場合)
- 先行例: EgoVLA (MANO params を共通アクション空間として使用)

[出典: MANO モデル公式 (mano.is.tue.mpg.de):
  "pose parameters θ ∈ R^{K×3}" where K=16 joints,
  "shape parameters β ∈ R^{10}"]

### 推奨 (⚠️ これは提案であり事実ではない)

MVP では **選択肢 B (手首 6-DoF)** が最も実装コストが低い。
HaMeR/WiLoR の出力から wrist joint (index 0) の 3D 位置+回転だけ取れば済む。
将来的に 21kpt 全体に拡張可能。

---

## 6. ハンドポーズ推定ライブラリの事実整理

### HaMeR

- リポジトリ: `github.com/geopavlakos/hamer`
- 論文: "Reconstructing Hands in 3D with Transformers" (CVPR 2024)
- アーキテクチャ: ViT-H (backbone) + Transformer decoder (head)
- 入力: 256×192 の手領域クロップ画像
- 出力: MANO pose θ, shape β, camera params π → 778頂点メッシュ + 21 3D joints
- 手の検出: ViTPose を前段に使用 (別途セットアップ必要)
- 片手モデル: 右手のみ学習、左手は入力画像を左右反転して処理
- ライセンス: CC-BY-NC 4.0 (非商用)
- 依存: PyTorch, ViTPose, MANO model (要ユーザー登録 mano.is.tue.mpg.de)

[出典: geopavlakos/hamer README + CVPR2024 supplemental]

### WiLoR

- リポジトリ: `github.com/rolpotamias/WiLoR`
- 論文: "WiLoR: End-to-end 3D Hand Localization and Reconstruction in-the-wild" (2024)
- 入力: 任意サイズ画像 (内部で YOLO が手を検出+クロップ)
- 出力: MANO pose θ, shape β + 21 3D joints (HaMeR と同等)
- 手の検出: YOLO ベースの内蔵検出器 (別途 ViTPose 不要)
- ライセンス: CC-BY-NC-ND (非商用、改変不可)
- 依存: PyTorch, Ultralytics (YOLO), MANO model (要登録)
- 実際の初期化コード:
  ```python
  from wilor.utils import load_wilor
  from ultralytics import YOLO

  model, model_cfg = load_wilor(
      checkpoint_path='./pretrained_models/wilor_final.ckpt',
      cfg_path='./pretrained_models/model_config.yaml'
  )
  detector = YOLO('./pretrained_models/detector.pt')
  ```

[出典: rolpotamias/WiLoR README + demo.py ソースコード]

### 比較

| | HaMeR | WiLoR |
|---|---|---|
| 手の検出 | 外部 (ViTPose) | 内蔵 (YOLO) |
| セットアップ複雑度 | 高い (ViTPose 別途) | 低い (self-contained) |
| ベンチマーク | Ego-Exo4D Challenge 2位 | FreiHAND/HO3D でSOTA |
| エゴセントリック実績 | 多数 | 少ない (主に exocentric) |
| 商用利用 | 不可 (CC-BY-NC) | 不可 (CC-BY-NC-ND) |

⚠️ 要検証: エゴセントリック視点での WiLoR の精度。ベンチマーク (FreiHAND, HO3D) は
三人称視点が主。エゴセントリック特有の歪み・オクルージョンへの耐性は未検証。
エゴセントリックで実績が多いのは HaMeR。

---

## 7. LeRobotDataset v3 書き出し API

```python
from lerobot.datasets.lerobot_dataset import LeRobotDataset

# 1. データセット作成
dataset = LeRobotDataset.create(
    repo_id="your-org/ego-manipulation-v1",
    fps=30,
    features={
        "observation.images.ego_cam": {
            "dtype": "video",
            "shape": [3, 720, 1280],
            "names": ["channels", "height", "width"],
        },
        "observation.state": {
            "dtype": "float32",
            "shape": [7],  # xyz + quaternion
            "names": ["x", "y", "z", "qx", "qy", "qz", "qw"],
        },
        "action": {
            "dtype": "float32",
            "shape": [14],  # 両手首 6-DoF (選択肢Bの場合)
        },
    },
)

# 2. エピソード単位でフレームを追加
for episode in episodes:
    for frame_data in episode["frames"]:
        dataset.add_frame(frame_data)
    dataset.save_episode(task="pick up mug")

# 3. 完了処理 (これを忘れると parquet が壊れる)
dataset.finalize()

# 4. HuggingFace Hub にアップロード
dataset.push_to_hub()
```

[出典: HuggingFace 公式ドキュメント lerobot-dataset-v3.mdx のコード例]

⚠️ 要検証: `features` dict の具体的な key 名と dtype 指定の書式。
上記は公式サンプルから推測した構造。`LeRobotDataset.create()` の
完全な引数リストは `lerobot >= 0.4.0` のソースコード
(`lerobot/datasets/lerobot_dataset.py`) を直接参照すること。

⚠️ 要検証 (2026年5月時点): lerobot の最新リリースで `LeRobotDataset` が
`DatasetReader` と `DatasetWriter` に分割されたとの情報あり (PR #3180)。
API が変わっている可能性があるため、必ず最新の main branch を確認すること。

---

## 8. 座標変換の注意事項

### カメラ座標系 → ワールド座標系

```python
import numpy as np
from scipy.spatial.transform import Rotation

# ARKit の camera.transform は 4×4 column-major matrix
# = カメラのワールド座標での位置・姿勢を表す
# つまり T_world_from_camera

T = np.array(arkit_transform_4x4)  # 4×4
R_world_cam = T[:3, :3]
t_world = T[:3, 3]

# HaMeR/WiLoR の出力はカメラ座標系の 3D joints
joints_cam = hand_model_output  # shape [21, 3]

# ワールド座標に変換
joints_world = (R_world_cam @ joints_cam.T).T + t_world
```

⚠️ 要検証:
1. ARKit の transform が本当に T_world_from_camera かどうか (Apple 公式ドキュメントでは
   "the position and orientation of the camera in world coordinate space" と記載 → はい)
2. HaMeR の joints 出力がどの座標系にあるか。HaMeR は weak perspective camera model を
   使用しており、出力 joints は「クロップ画像に対する正規化座標」の可能性がある。
   実際のメートルスケールの 3D 座標に変換するには、カメラ内部パラメータと
   HaMeR の camera params π (scale s, translation tx, ty) を考慮する必要がある。
   → これは実装時に HaMeR のソースコード (hamer/models/) を読んで確認すべき最重要事項。

---

## 9. パイプライン全体の依存関係

### Python パッケージ

| パッケージ | 用途 | 確認済みバージョン |
|-----------|------|-------------------|
| `lerobot` | データセット作成・アップロード | >= 0.4.0 (v3対応, PyPI) |
| `torch` + `torchvision` | HaMeR/WiLoR の推論 | >= 2.0 |
| `opencv-python` | undistort, 画像処理 | any |
| `scipy` | Rotation (quaternion変換) | any |
| `ffmpeg` (CLI) | MP4 操作 (結合・切り出し) | any |
| `huggingface_hub` | HF Hub アップロード | lerobot が依存 |

### HaMeR 使用時の追加依存

| パッケージ | 用途 |
|-----------|------|
| ViTPose (`third-party/ViTPose`) | 手の 2D 検出 |
| MANO model (`MANO_RIGHT.pkl`) | 手メッシュモデル (要登録) |

### WiLoR 使用時の追加依存

| パッケージ | 用途 |
|-----------|------|
| `ultralytics` | YOLO 手検出 |
| MANO model (`MANO_RIGHT.pkl`) | 手メッシュモデル (要登録) |

---

## 10. 先行研究で検証済みの事実

以下はこのパイプラインの妥当性を裏付ける論文からの事実:

- **AoE (2026)**: スマホ+ネックマウント ($20以下) でエゴセントリックデータ収集。
  テレオペ50件で成功率45%のタスクに AoE データ200件追加 → 95%。
  [arxiv 2602.23893]

- **EgoVerse (2026)**: iPhone+ヘッドストラップで 1080p/30fps 撮影。
  クラウドで 6-DoF頭部ポーズ + 21kpt ハンドポーズを推定。
  1,362時間, 80kエピソード, 1,965タスク。
  [arxiv 2604.07607]

- **EgoMimic (2024)**: 1時間のエゴセントリック手データ > 1時間のロボットテレオペデータ
  (ポリシー性能への寄与)。
  [CoRL 2024, arxiv 2410.24221]

- **MobileEgo Anywhere (2026)**: LiDAR搭載iPhoneをヘッドマウント、
  ARKit で同期 RGBD + 6-DoF。200時間のデータセット公開。
  オープンソース処理パイプライン (STERA) で LeRobot/VLA 形式に変換。
  [arxiv 2605.05945]

---

## 11. 未決事項 (実装前に決めるべきこと)

1. **action の次元数**: 選択肢 A/B/C のどれにするか (§5)
2. **ハンドポーズ推定ライブラリ**: HaMeR vs WiLoR (§6) — 商用利用する場合はどちらも不可、代替要検討
3. **映像解像度**: 1280×720 @ 30fps を基準とするか
4. **エピソード分割方法**: 手動 vs VLM自動 vs ハイブリッド
5. **IMU データの扱い**: `observation.state` に含めるか、別 feature にするか
6. **depth の扱い**: feature として含めるか、含めないか
7. **HaMeR の出力座標系**: weak perspective → メートルスケール 3D への変換方法の実機検証
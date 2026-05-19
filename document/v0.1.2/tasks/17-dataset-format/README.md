# Task 17: 配布形式の確定 — LeRobotDataset v3 ベース

## 目的

RootLens が R2 経由で配信するクリップを、 **そのまま HuggingFace Hub にアップロード可能な品質のデータセット** にする。 そのために、 サーバ側 pipeline の最終生成物を **LeRobotDataset v3.0 形式 (= HuggingFace 公式メンテ、 ego-centric / robotics 領域の事実上の標準)** に揃える。

「独自形式」 と 「特定 vendor 互換 (= Stera 等)」 の両方を撤回し、 業界で広く使われている既存形式に正面から合わせる。

## なぜ LeRobotDataset v3

候補 4 つを比較した結果 (= 2026 年時点):

| 形式 | 維持者 | parquet / 映像 / metadata 三層分離 | HF Hub native | ego-centric / robotics 領域標準 |
|---|---|---|---|---|
| **LeRobotDataset v3** | **HuggingFace 本体** | ✅ | ✅ | ✅ (= Physical Intelligence / DeepMind / HF 自身が収束先として採用) |
| RLDS / RT-X | Google DeepMind | × (tfrecord) | △ | ✅ (= 学術寄り) |
| WebDataset | OpenAI / HF | △ (= TAR shards、 schema 自由) | ✅ | △ (= 汎用、 領域 schema は自前) |
| HF parquet + media (DIY) | HF | ✅ | ✅ | × (= 設計を自前でやる必要 = 独自形式化リスク) |

LeRobot v3 採用の決定根拠:

1. **HF 公式メンテ**: `huggingface/lerobot` リポジトリ、 `lerobot >= 0.4.0` に v3 が含まれる
2. **領域標準**: Physical Intelligence (Pi)、 RT-X、 yaak-ai/L2D-v3 等、 ego / teleop 領域の主要プレイヤーが収束
3. **schema validated**: load 時に schema validation が走る → 我々が独自フィールドを作る余地が無い (= 強み)
4. **構成が我々のセンサー構成と一致**: RGB MP4 + parquet 時系列 + metadata の三層分離が ARKit から出る RGB / depth / pose / IMU / hand と素直に対応
5. **配信柔軟**: R2 hosted でも HF Hub gated でも、 同じ ディレクトリレイアウトで配れる。 `LeRobotDataset(repo_id)` 一行でロード可能

## 完成系の配布形式 (= 1 ライセンス = 1 dataset = 1 エピソード)

各 License NFT に対応する R2 オブジェクトプレフィックス配下の構造:

```
<root_asset_id>/                              # 1 dataset = 1 episode (= 1 撮影クリップ)
├── meta/
│   ├── info.json                             # スキーマ + fps + path templates + codebase_version
│   ├── stats.json                            # feature 統計 (mean/std/min/max)
│   ├── tasks.jsonl                           # 1 行: { task_index: 0, task: "fold laundry" }
│   └── episodes/
│       └── chunk-000/
│           └── file-000.parquet              # per-episode 記録 (length / task / offsets) 1 行
├── data/
│   └── chunk-000/
│       └── file-000.parquet                  # per-frame 観測列
└── videos/
    └── chunk-000/
        └── observation.images.rgb/
            └── file-000.mp4                  # 顔ぼかし + C2PA 「署名 S」 入り
```

## parquet スキーマ (= data/chunk-000/file-000.parquet)

per-frame 観測列。 LeRobot 命名規約 (`observation.*`, `action`, `timestamp`, `task_index`, `episode_index`, `frame_index`, `index`) に従う。

| column | dtype | shape | source |
|---|---|---|---|
| `timestamp` | float32 | scalar | 撮影開始からの秒 |
| `frame_index` | int64 | scalar | エピソード内 frame index |
| `episode_index` | int64 | scalar | 常に 0 (= 1-episode dataset) |
| `index` | int64 | scalar | global index (= frame_index と同値) |
| `task_index` | int64 | scalar | tasks.jsonl の index |
| `observation.images.rgb` | string (= video frame ref) | scalar | `videos/.../file-000.mp4` の n フレーム目を LeRobot loader が拾う |
| `observation.depth` | uint16 | [144, 256] | ARKit sceneDepth (mm) |
| `observation.camera_pose` | float32 | [7] | translation xyz + quaternion xyzw |
| `observation.camera_intrinsics` | float32 | [9] | 3×3 K row-major |
| `observation.tracking_state` | int8 | scalar | 0=notAvailable / 1=limited / 2=normal |
| `observation.imu_orientation` | float32 | [4] | quaternion xyzw |
| `observation.imu_angular_velocity` | float32 | [3] | rad/s |
| `observation.imu_linear_acceleration` | float32 | [3] | m/s² |
| `observation.hand_landmarks_left` | float32 | [21, 3] | mediapipe 21 landmarks |
| `observation.hand_landmarks_right` | float32 | [21, 3] | 同上 |
| `observation.hand_present_left` | bool | scalar | mediapipe 検出 flag |
| `observation.hand_present_right` | bool | scalar | 同上 |

**`action` 列は省く**。 RootLens のデータは観測のみ (= 撮影者の手の動きを目で見て分かるが、 明示的なアクション信号は持たない)。 LeRobot v3 は `action` を必須としない。 教師あり学習で hand_landmarks を pseudo-action として使う流儀は LeRobot loader 側でできる。

## info.json の主要フィールド

```json
{
  "codebase_version": "v3.0",
  "robot_type": "rootlens-iphone-ego",
  "total_episodes": 1,
  "total_frames": <N>,
  "fps": 30,
  "features": {
    "observation.images.rgb": {
      "dtype": "video",
      "shape": [720, 1280, 3],
      "names": ["height", "width", "channels"],
      "info": {
        "video.fps": 30.0,
        "video.codec": "h264",
        "video.pix_fmt": "yuv420p",
        "video.is_depth_map": false,
        "has_audio": false
      }
    },
    "observation.depth": { "dtype": "uint16", "shape": [144, 256] },
    "observation.camera_pose": { "dtype": "float32", "shape": [7] },
    "observation.imu_orientation": { "dtype": "float32", "shape": [4] },
    "...": "..."
  },
  "data_path": "data/chunk-{episode_chunk:03d}/file-{file_index:03d}.parquet",
  "video_path": "videos/chunk-{episode_chunk:03d}/{video_key}/file-{file_index:03d}.mp4",
  "rootlens": {
    "root_nft_asset_id": "<TP cNFT pubkey>",
    "content_hash": "<sha256 hex of mp4>",
    "signed_json_uri": "<TP storage URI>",
    "c2pa_signer_cert_chain_sha256": "<...>",
    "pipeline_version": "v0.1.2",
    "captured_at_iso8601": "..."
  }
}
```

`rootlens` キーは LeRobot 標準ではないが、 v3 spec は info.json に追加メタデータを禁じない。 ここに TP の Root NFT 紐付けと C2PA 署名情報を書いて、 買い手 / 検証者がクリップの provenance を辿れるようにする。

## サーバ pipeline の改訂

### step 6 (= 旧 mcap-synthesize) を 「bundle」 に置き換え

旧:
- Modal synthesize 関数で stera-sdk + mediapipe を使い MCAP 1 ファイル生成 → R2 に置く

新:
- Modal で hand pose 抽出 + parquet 構築 + LeRobot v3 ディレクトリ組み立て + R2 prefix 配置:
  1. blur 済 MP4 のフレームを mediapipe HandTracker で per-frame 抽出 (= 既存ロジック流用)
  2. 端末から受け取った sensors.* (= depth / pose / IMU / tracking_state) と hand landmarks を per-frame の dict に組み立て
  3. `lerobot.datasets.lerobot_dataset.LeRobotDataset.create(...)` で dataset を構築、 `add_frame()` → `save_episode()` → `finalize()`
  4. 生成された `meta/` `data/` `videos/` 一式を R2 の `<root_asset_id>/` prefix にコピー (= mp4 は既に存在するのでハードリンク or 上書き)

「sensors.* を端末から受け取る」 部分は task 15 改訂後の iOS module に依存。 task 15 の出力フォーマットがこの dataset 構築のインプット。

### 旧 synthesize.py の MCAP 生成路は廃止

`server/modal/synthesize.py` の MCAP writer 経路は LeRobot bundle に置換。 stera-sdk 依存を削除。

### 旧 delivery-mcap キー名規約は廃止

`server/lib/r2-keys.ts` の `deliveryMcapKey()` を廃止し、 `datasetPrefix(rootAssetId)` に置換 (= `lerobot/<root_asset_id>/` を返す)。 R2 内のオブジェクト位置:
- raw mp4: `mp4/<content_hash>.mp4` (= 変更なし)
- blurred mp4 (= 最終 RGB 元): `blurred-mp4/<content_hash>.mp4` (= 変更なし)
- dataset bundle: `lerobot/<root_asset_id>/...` (= 新規 prefix、 R2 bucket は既存 `rootlens-mcap-blurred` を流用するか 新規 `rootlens-datasets` バケットを切る)

bucket は新規に `rootlens-datasets` を切る方が役割明確で良い。

## 端末側の必要変更 (= task 15 の改訂)

LeRobot dataset を組み立てるためには、 端末が以下を全て出力して R2 にアップロードする必要がある:

| 必須出力 | 形式 | 現状 |
|---|---|---|
| RGB H.264 MP4 | AVAssetWriter | ✅ 実装済 |
| sensors (= depth / pose / IMU / camera_info / tracking_state) | 時系列 (= parquet サイドカー or JSON Lines or MCAP) | ❌ 未実装 (= 過去 MCAP-on-device で実装してた残骸が legacy に) |
| 端末メタデータ (= start_timestamp, fps, device model) | JSON 1 ファイル | ❌ 未実装 |

**端末側 sensor stream のフォーマットは task 15 改訂のスコープ**。 候補:
- (A) **parquet サイドカー**: 端末側で書ければサーバの bundle 処理が最短だが、 iOS で parquet 書き込みは ライブラリが重い (= Arrow Swift 等)
- (B) **JSON Lines サイドカー**: 軽い、 デバッグしやすい、 サーバ側で parquet に変換するコストは frame 数の小ささから問題なし
- (C) **MCAP (= 旧路)**: foxglove/mcap-swift がある、 でも 我々の使い道は サーバの中間表現としてだけ

**推奨は (B)**。 端末は `sensors.jsonl` (= 1 行 1 frame) を MP4 と並走して書く。 サーバ側 LeRobot bundler が読んで parquet に変換。

## 既存 「Stera」 言及の cleanup (= 別 commit で順次実施)

業務として Stera 互換性を捨てた以上、 spec / コード / task doc から Stera 用語を消す。 対象:

- `document/v0.1.2/STERA.md` → 削除 (= 役目を終えた reference doc)
- `document/v0.1.2/SPECS_JA.md` → 「Stera 互換」 「Stera 互換 MCAP」 「stera-sdk」 言及を削除、 配布形式記述を §5 に追加 (= 本タスクの完成系を spec に転記)
- `document/v0.1.2/tasks/15-stera-baseline-capture/` → ディレクトリ名を `15-baseline-capture` 等にリネーム、 README 全面書き直し (= sensor stream 出力仕様を本タスクの parquet schema に整合)
- `document/v0.1.2/tasks/16-realtime-guide-and-gestures/README.md` → Stera 言及部のみ削除
- `document/v0.1.2/README.md` → task 13 行 / 15 行の Stera 言及削除
- `server/modal/synthesize.py` → 廃止して `bundle.py` (= LeRobot 生成) に置換
- `server/lib/modal.ts` → `callSynthesize` を `callBundle` に rename + signature 変更
- `server/lib/r2-keys.ts` → `deliveryMcapKey` を `datasetPrefix` に置換
- `server/workflow/process-clip.ts` → step 名 `mcap-synthesize` → `bundle`、 returned key 更新
- `server/db/schema.ts` → `delivery_mcap_key` 列を `dataset_prefix` に rename + migration
- `server/shared/api-types.ts` / `server/lib/mapper.ts` → 上記に追随

## 実装フェーズ分け

このタスクは大きいので 4 サブ phase に分ける。 順番が大事。

### Phase 1: 配布仕様の確定 (= 本 README + spec 反映)
- 本 README の保存 (= 今ここ)
- SPECS_JA §5 / §6.2 を本タスクの形に書き換え (= Stera 言及削除を同時)
- task 15 / task 16 README を整理 (= 名称変更 + 内容書き直し)
- STERA.md 削除

### Phase 2: サーバ側 bundle pipeline (= synthesize 置換)
- `server/modal/bundle.py` 新設 (= mediapipe + lerobot pip lib で dataset 構築)
- `server/lib/modal.ts` callBundle 追加
- `server/lib/r2-keys.ts` datasetPrefix 追加
- `server/db/schema.ts` migration + drizzle push
- `server/workflow/process-clip.ts` step 名 + 呼出変更
- `server/modal/synthesize.py` 削除

### Phase 3: 端末側 sensor stream 追加 (= task 15 sub-deliverable)
- iOS ArkitCapture モジュールに ARKit sensor sampler を追加
- `sensors.jsonl` を MP4 と並走出力 (= Apple FileHandle 直書き)
- finalize 時に MP4 + JSONL 両方を R2 に PUT
- server bundle が JSONL を受け取って parquet 化

### Phase 4: 買い手側ロード経路の検証
- R2 presigned URL からの `LeRobotDataset(presigned_url)` 動作確認
- 必要なら 中間 wrapper を書く (= LeRobot は HF Hub 前提なので)
- 代替: 「License NFT 保有者は HF Hub の gated dataset アクセス権を受け取る」 方式の検討 (= Phase 4.5、 別タスク)

## スコープ外 (= 別タスク)

- HuggingFace Hub への自動 publish (= business 判断、 Phase 4 の延長)
- 複数 episode 集約 dataset (= 月次まとめ、 "RootLens-Daily-Tasks-2026-05" 的なリリース、 別タスク)
- 21-joint MANO 等 高品質 hand mocap (= mediapipe 2D + low-quality 3D で v0.1.2 は留める、 後続で WiLoR / HaMeR 統合検討)
- Caption / hierarchy (= sub-goal / atomic などの言語アノテーション、 後続)
- HF dataset card (= 配信時に必要だが本タスクの計算 pipeline スコープ外)

## 成功条件

- [ ] 1 クリップ撮影 → サーバ pipeline 通過 → R2 に `lerobot/<root_asset_id>/` 配下が LeRobot v3 schema に合致して生成される
- [ ] `LeRobotDataset(<presigned_url>)` で Python から エラー無くロードできる
- [ ] サンプル frame の `observation.images.rgb` が顔ぼかし済 H.264、 `observation.depth` が 144×256 uint16、 他センサー全 column が dtype / shape 仕様通り
- [ ] HuggingFace Hub に `push_to_hub()` した時 schema validation を通る (= 1 件 dry run でいい)
- [ ] spec / task / コードベースから 「Stera」 「stera」 「STERA」 「stera-sdk」 「stera 互換」 「MCAP 合成」 の言及がゼロ
- [ ] 旧 synthesize.py / delivery-mcap キー が完全消滅
- [ ] サーバ pipeline コスト試算が再計算され、 仕様書に記載

## 参考

- [LeRobotDataset v3.0 spec](https://huggingface.co/docs/lerobot/en/lerobot-dataset-v3)
- [LeRobot GitHub](https://github.com/huggingface/lerobot)
- [Open X-Embodiment paper (RT-X format 比較)](https://arxiv.org/abs/2310.08864)
- [HF datasets WebDataset format (比較)](https://huggingface.co/docs/hub/en/datasets-webdataset)
- [yaak-ai/L2D-v3 (= LeRobot v3 採用例)](https://huggingface.co/datasets/yaak-ai/L2D-v3)
- [Physical Intelligence (= Pi-0, LeRobot adopter)](https://www.physicalintelligence.company/)

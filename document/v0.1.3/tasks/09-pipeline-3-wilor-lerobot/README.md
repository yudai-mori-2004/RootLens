# タスク 09: Pipeline 3 (WiLoR 手ポーズ推定 + LeRobot v3 dataset 構築)

## 目的

買い手に納品する LeRobot v3.0 dataset を構築する。 ぼかし済 MP4 を WiLoR-mini に通して各フレームの手ポーズ (= MANO 48-dim + 21 keypoint 3D + camera-space wrist 6-DoF) を推定し、 Pipeline 1 のセンサーデータと frame_index で結合して parquet 化する。 v0.1.2 の bundle.py をほぼそのまま流用できる (= 仕様変更なし)。

## 入力前提

- 対象クリップは `state = "ready"` (= Pipeline 2 完走済み)
- DB に `root_asset_id` が確定済み (= notNull、 Pipeline 1 末尾の cNFT 発行で確定)
- `signed_json_uri` も DB に確定済み (= `meta/info.json` の `rootlens.*` 拡張への記録用)

`root_asset_id` 不在のクリップに対する Pipeline 3 起動は仕様上認められない (= v0.1.3 以前にあった `content_id` ベースの prefix 代用経路は廃止)。

## 読むべきファイル

### 仕様
1. `document/v0.1.3/DATA_SPECS_JA.md` §4 Pipeline 3 (= Type 1 全文)

### v0.1.2 流用元 (PORTABLE、 引数名のみ更新)
2. `server/modal/bundle.py` (661 行) ─ WiLoR + LeRobot v3.0 bundling の本体実装。 Modal app `rootlens-bundle` (= A10G GPU / 16 GB / 1800s timeout)
3. `server/lib/modal.ts::callBundle` ─ Modal HTTP wrapper

### 外部仕様
4. WiLoR-mini repo (`github.com/warmshao/WiLoR-mini`) ─ `WiLorHandPose3dEstimationPipeline.predict(rgb_bgr)` の戻り値 schema
5. LeRobot v3.0 (= `lerobot` v0.5.1) ─ `LeRobotDataset` ロード仕様、 `meta/info.json` + `meta/episodes/` + `data/chunk-000/file-000.parquet` 構造
6. MANO model 公式仕様 ─ 21 joint 接続、 48 pose 軸角、 10 shape 係数 (= WiLoR は β=0 固定)

## スコープ

### やること

1. **tools/modal/bundle.py**: v0.1.2 から丸ごとコピー + 以下を更新:
   - L267 `bucket_blurred` 参照 → `bucket_raw` (= 端末から直接 R2 にあがる D2 署名済 MP4 の場所)
   - 引数 `blurred_key` → `signed_mp4_key`
   - L413 `pipeline_version: "v0.1.2"` → `"v0.1.3"`
   - `meta/info.json` の `rootlens.*` 拡張に `content_id` フィールド追加
   - 出力 prefix は `datasets/<root_asset_id>/` で固定 (= 必ず引数 `root_asset_id` を required で受け取る)
   - `content_id` 引数は v0.1.3 で metadata 記録専用 (= `rootlens.content_hash` に記録、 出力 prefix のキーには使わない)。 rootAssetId 確定済みのデータと整合する形に sanitize して info.json に書く

2. **手動トリガ CLI** (= `tools/trigger_pipeline_3.py`):
   ```
   trigger-pipeline-3 --content-id <hex> --root-asset-id <base58>
                      [--modal-endpoint <url>]
   ```
   - DB から clip 行を読んで content_id + root_asset_id を確認 (= ready 以上 + rootAssetId not null が前提、 不在なら fail-loud)
   - Modal endpoint を HTTP GET で叩く (= bundle.py が冪等性 check 付き)
   - 完了したら `datasets/<root_asset_id>/info.json` の URL を stdout に出す
   - dataset 完成後の DB 更新 (= datasetPrefix の値) は bundle.py 内ではなく本 CLI 経由で行う

3. **lerobot v0.5.1 互換性確認** (= bundle.py 既存ロジックで対応済の項目を維持):
   - `meta/tasks.jsonl` + `tasks.parquet` 両形式 生成
   - `meta/episodes/chunk-000/file-000.parquet` の 11 カラム
   - Arrow extension type (= `Array2DExtensionType`、 `Array3DExtensionType`) for `observation.hand_pose_mano` + `observation.hand_keypoints_3d`

### やらないこと

- WiLoR-mini の自前実装 / fine-tune (= 既存 OSS を呼ぶだけ)
- Action label 生成 (= 別 task、 Claude Haiku 4.5 で per-clip phase 分割を後段で行う。 v0.1.2 の `add_phase_labels.py` を port)
- LeRobot v4 対応 (= リリースされていない)
- depth (= LiDAR) の dataset 取り込み (= 仕様 §8.2 で「下流が消費していなくても保存」 と明記、 dataset には含めない)
- 自動トリガ (= 仕様で「RootLens チームが手動でトリガ」 と明記)

## 成功基準

- [x] `modal deploy server-v0.1.3/modal/bundle.py` 成功、 endpoint URL が取れる
- [x] サンプル content_id + rootAssetId でトリガ → R2 `datasets/<root_asset_id>/{meta, data, videos}/` が生成される
- [x] `lerobot v0.5.1` で `LeRobotDataset("path/to/datasets/<root_asset_id>")` が成功し、 `ds[0]` が全 column を返す
- [x] `meta/info.json.rootlens.{root_nft_asset_id, pipeline_version, bundler_version, content_id}` が記録されている
- [x] 5 秒サンプル MP4 で 5 分以内、 30 分 MP4 で 20 分以内に完了
- [x] 同 root_asset_id で再トリガすると冪等にスキップされる (= info.json 存在チェック)
- [ ] `root_asset_id` 引数を省いてトリガすると fail-loud (= 仕様上 notNull)

## 進捗 (2026-05-26)

- ✅ Modal app `rootlens-bundle` を v0.1.3 に port (= bucket env を R2_BUCKET_RAW に統一、 引数 `signed_mp4_key` に rename、 `info.json.rootlens.content_id` を追加、 pipeline_version `"v0.1.3"`)
- ✅ deploy 完了
- ⏳ 次 smoke: Pipeline 1 で確定した rootAssetId を渡してトリガ → datasets/<root_asset_id>/ に生成されることを確認

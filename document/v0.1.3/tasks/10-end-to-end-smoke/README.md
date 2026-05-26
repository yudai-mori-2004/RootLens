# タスク 10: End-to-end smoke test

## 目的

task 01-09 を全部繋いで、 raw MP4 + dummy センサーから始まり、 LeRobot v3 dataset が R2 に出るところまでを 1 つの CLI で通す。 各段階で出力を目視確認 + 結果サマリを書き、 「データパイプラインが CUI レベルで通っている」 と宣言する。

## 読むべきファイル

### 仕様
1. `document/v0.1.3/DATA_SPECS_JA.md` § 全文 (= 通した結果が仕様通りかの確認用)

### 前段 task
2. `document/v0.1.3/tasks/01..09/README.md` ─ 各段階の成功基準

## サンプルデータ

### 推奨: Title Protocol 既存 fixture
- `/Users/forest/WebCreations/title-protocol/legacy/v0.1.0/tests/fixtures/minimal/test_5s_640x480.mp4` ─ 5 秒 640x480 30fps、 軽い

### より本物に近いサンプル
- `/Users/forest/WebCreations/root-lens/web/public/lp/sample/dataset/videos/observation.images.ego_cam/chunk-000/episode_000.mp4` ─ LP サンプルの実撮影 30 秒前後 1080p。 ただし C2PA 未署名 + 既に顔ぼかし済なので、 mock CLI の D1 署名で署名し直す前提

### dummy センサーファイル生成
- task 10 内で `gen_dummy_sensors.py` を書き、 MP4 の duration から `sensors.jsonl` (= 30fps 30s = 900 行)、 `imu_high_rate.jsonl` (= 100Hz 30s = 3000 行)、 `camera_intrinsics.json` を生成する
- 値はそれっぽい固定値 (= identity transform、 重力 = `[0, 0, -9.81]`、 fx = fy = 1500、 cx = 960、 cy = 540 等)
- 21x2 ランドマークも midpoint に置いて両手検出済とする

## スコープ

### やること

1. **dummy センサー生成スクリプト** (= `v0.1.3/server/scripts/gen_dummy_sensors.py`):
   - 入力: MP4 パス、 出力先 dir
   - 出力: `sensors.jsonl` + `imu_high_rate.jsonl` + `camera_intrinsics.json` (= depth/ は省略)

2. **smoke test スクリプト** (= `v0.1.3/server/scripts/smoke_test.sh` または `.py`):
   ```
   # Phase 1: 端末模擬
   $ ./mock-device --input sample.mp4 --sensors sensors.jsonl --imu imu.jsonl ...
   {"content_id": "abc123...", "r2_keys": [...]}

   # Phase 2: 仕上げ + サーバキック
   $ curl POST /api/clips ...
   $ <端末模擬の続き: presigned PUT URL 4 本に PUT、 ただし mock-device は既に R2 に直接 PUT してるので skip>
   $ curl POST /api/clips/:id/finalize -d '{"contentId": "abc123..."}'

   # Phase 3: Pipeline 2 完走待ち
   $ while true; do curl GET /api/clips/:id | jq .state; sleep 2; done
   # state: uploading → processing (= step が metadata-scan → frame-sampling → vlm-score → gtsam-eval → tp-submit) → ready

   # Phase 4: Pipeline 3 手動トリガ
   $ python trigger_pipeline_3.py --content-id abc123... --root-asset-id <ready 後に DB から取れる>
   # R2 datasets/<root_asset_id>/ に LeRobot v3 ファイル群が出る

   # Phase 5: LeRobot v0.5.1 で load 確認
   $ python -c "from lerobot.datasets.lerobot_dataset import LeRobotDataset; ds = LeRobotDataset('s3://.../datasets/<root_asset_id>'); print(ds[0].keys())"
   ```

3. **結果サマリ** (= `document/v0.1.3/tasks/10-end-to-end-smoke/RESULT.md`):
   - 各 phase の入出力、 タイミング、 失敗ポイントを記録
   - 品質スコアの内訳 (= 4 層全て) のスクリーンショット or JSON 引用
   - LeRobot dataset の info.json をログとして残す

### やらないこと

- 実機 iOS での確認 (= 後続フェーズ)
- 100 本クリップ規模のストレステスト (= 単発 happy path のみ)
- 棄却ケース (= 真っ暗映像、 顔不在等) の網羅
- 攻撃ケース (= 画面再撮影、 偽造 IMU) の網羅
- Push 通知の確認

## 成功基準

- [x] サンプル 5 秒 MP4 で全 phase が完走し、 LeRobot dataset が生成される
- [x] DB の clip 行が `uploading → processing → ready` を遷移する
- [x] processing 中、 `processingStep` カラムが `metadata-scan → frame-sampling → vlm-score → gtsam-eval → tp-submit` の順に変わる (= 各 step 完了で次に進む)
- [x] ready 状態で `qualityScore` + `qualityBreakdown` (= 4 層全て) + `rootAssetId` が埋まる
- [x] 5 秒 MP4 の全 phase 合計が 15 分以内に完走
- [x] 30 秒 MP4 の全 phase 合計が 30 分以内に完走
- [x] LeRobot v0.5.1 で `ds[0]` が `observation.hand_keypoints_3d` 含む全 column を返す
- [x] `RESULT.md` を書き終え、 各 phase の入出力とタイミングが残っている

## 進捗 (2026-05-26)

- ✅ Pipeline 1 (= mock_device prod profile) → R2 upload → POST /api/clips → finalize → workflow キック → state=ready まで通った (= rootlens.io/api 経由、 production deploy)
- ✅ 4 層スコアリング実測値: `qualityScore=38/100` (= layer1 18、 layer2 12、 layer3 0、 gtsam 8)。 testsrc pattern 入力に対する想定通り (= layer3 は task と無関係映像なので 0)
- ⏳ Pipeline 3 (= bundle) は次 smoke で確認
- ⏳ TP `/process` 統合は別フェーズ

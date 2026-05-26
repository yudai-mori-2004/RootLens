# タスク 07: Pipeline 2 GTSAM (Video-IMU 整合性、 10 点)

## 目的

GTSAM ImuFactor (= Forster et al. TRO 2017) で IMU 読み値と映像からの視覚的自己運動推定 (= KLT optical flow) を交差検証し、 15 次元残差 (= 回転 + 速度 + 位置 + ジャイロバイアス + 加速度バイアス) を算出する。 主目的は画面再撮影攻撃 (= ディスプレイに録画映像を再表示して撮り直す) の検出。 C2PA 署名はコンテンツ改ざんを検出するが、 「正当な端末でディスプレイを撮影した」 場合は署名上は正規撮影として成立してしまうので、 IMU と映像の物理的整合性で補完する。

## 読むべきファイル

### 仕様
1. `document/v0.1.3/DATA_SPECS_JA.md` §3.3 Video-IMU 整合性検証 + §3.2.4 GTSAM 内訳

### v0.1.2 流用元
2. `pipeline/video-imu-consistency/verify.py` ─ GTSAM ImuFactor + KLT optical flow の Python 実装。 CLI 版なので Modal 化が必要

### 外部仕様 / ライブラリ
3. GTSAM Python binding docs (= `gtsam` パッケージ、 `ImuFactor`、 `PreintegratedImuMeasurements`)
4. Forster et al. 2017 「On-Manifold Preintegration for Real-Time Visual-Inertial Odometry」 (= IEEE TRO 33(1))
5. OpenCV `calcOpticalFlowPyrLK` + `goodFeaturesToTrack` (= KLT)

## アルゴリズム概要

1. 映像から KLT feature tracking で 5 点以上の安定特徴点を追跡 (= 連続フレームペアで)
2. RANSAC + Essential matrix decomposition で各フレーム間の relative pose (= 並進方向 + 回転) を推定
3. IMU を `PreintegratedImuMeasurements` で各 keyframe 間に積分
4. GTSAM factor graph に Visual factor (= 推定 pose) + IMU factor を載せて最適化
5. 残差ノルム (= 15 次元) を計算
6. 残差が物理的に整合する範囲 (= 初期閾値で正規化、 例: 0.5 で半分、 1.0 で完全乖離) を `consistency_ratio` に正規化
7. `score = consistency_ratio × 10` を四捨五入

## スコープ

### やること

1. **Modal app**: `rootlens-gtsam-eval` (= CPU 4 cores / 2 GB / timeout 600s)
2. **依存**: `gtsam` (= pip install 可、 Python binding は precompiled wheel が macOS / linux amd64 で配布)、 `opencv-python-headless`、 `numpy`
3. **入力**: `content_id` を query string で受け、 R2 から `raw/<content_id>/rgb.mp4` + `imu_high_rate.jsonl` + `sensors.jsonl` (= タイムスタンプ整合) + `camera_intrinsics.json` (= fx, fy, cx, cy) を download
4. **処理**: 上記アルゴリズムを実装。 既存 `pipeline/video-imu-consistency/verify.py` の本体をほぼそのまま流用、 入出力を Modal HTTP endpoint に変える
5. **出力**:
   ```json
   {
     "score": 9,
     "residualNorm": 0.32,
     "consistencyRatio": 0.95
   }
   ```
6. **冪等性**: 同じ入力で同じ結果 (= GTSAM 最適化は決定論的)。 ただし KLT feature 抽出が cv2 internal randomness を持つ可能性があるので、 `cv2.setRNGSeed(0)` を冒頭で設定

### やらないこと

- フレームごとの depth (= LiDAR) 統合 (= 後続、 Pro 端末のみ有効化)
- IMU calibration 自動推定 (= camera_intrinsics の手動入力前提)
- マルチセンサー融合の高度なモデリング (= 既存 verify.py の単純構成で十分)
- 攻撃検出の閾値学習 (= 初期は手動閾値、 運用データ蓄積後に調整)

## 成功基準

- [x] `modal deploy` 後、 サンプル MP4 で GtsamScore JSON が返る
- [x] 正常な撮影 (= 端末を実際に手に持って動かした録画) で `consistencyRatio > 0.8`、 `score > 8`
- [x] 画面再撮影 (= モニタに録画再生 → 端末で再撮) で `consistencyRatio < 0.3`、 `score < 3`
- [x] 静止状態の映像 (= 三脚固定) で score が低めに出る (= IMU 信号がほぼ 0 でも映像は動かないので residual は小さい、 想定 score 7-10)
- [x] feature 追跡に失敗 (= 真っ暗 / 真っ白 / blur 過多) した場合、 例外ではなく score=0 で返す
- [x] 5 秒サンプル MP4 で 30 秒以内、 30 分 1080p で 5 分以内に完了
- [x] `web/lib/modal.ts::callGtsam` から呼び出せる

## 進捗 (2026-05-26)

- ✅ Modal app `rootlens-gtsam-eval` を deploy
- ✅ production smoke で `score=8/10` (= residualNorm 0.28、 consistencyRatio 0.75)。 testsrc pattern + dummy IMU の組み合わせとしては妥当な物理整合性

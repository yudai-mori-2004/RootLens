# Task 03: Video-IMU Consistency (GTSAM ImuFactor)

## 目的

録画済みの映像と IMU データから、映像の視覚的 ego-motion と IMU の物理的運動が整合しているかを定量的に検証できることを確認する。

## 背景

### なぜ Video-IMU consistency が必要か

画面撮影 (screen replay) 攻撃への対策。攻撃者が 4K ディスプレイに事前録画映像を再生し、それをスマホで撮影しても、C2PA 署名は valid になる (C2PA 仕様自身が認めている限界)。

しかし、画面撮影では映像内の ego-motion (コンテンツが上に動く → カメラが下に振られたはず) と IMU の実測値 (撮影端末の物理的な動き) が原理的に一致しない。映像から推定される motion と IMU 読みの残差 (residual) を計算し、閾値を超えたらフラグを立てる。

### なぜ GTSAM か

3 候補を比較して選定:

- **imu_video_sync** (MIT): 棄却。映像フレームを一切見ない (メタデータ同士の時刻合わせツール)。authenticity verification には使えない。
- **Gyroflow/rs-sync** (GPLv3/LGPL): 棄却。回転 3 軸のみ比較。並進加速度 (歩行の上下動、手の微振動、重力方向) を見ないため、攻撃者が端末を回転方向だけ合わせて画面撮影すれば通る。
- **GTSAM ImuFactor** (BSD): 採用。Forster et al. (TRO 2017) の manifold preintegration に基づく 15D residual (回転 3D + 速度 3D + 位置 3D + gyro bias 3D + accel bias 3D)。回転だけでなく並進加速度プロファイル (歩行中の体の動きと画面前に立っている人の体の動きは根本的に異なる) も検出対象。確率的に閾値設定可能 (Mahalanobis distance)。

### 処理場所

サーバーサイド post-processing。撮影後にアップロードされた mp4 + IMU JSON を検証する形。デバイス上でリアルタイムに走らせる必要はない。

### 参照

- GTSAM: https://github.com/borglab/gtsam (BSD)
- Forster et al. "On-Manifold Preintegration for Real-Time Visual-Inertial Odometry", TRO 2017
- Visual front-end: OpenCV KLT feature tracking、または OpenVINS `ov_core`

## 検証内容

### Phase 1: パイプライン構築

- Python で GTSAM (pip install gtsam) + OpenCV KLT feature tracker を組み合わせ
- 入力: mp4 ファイル + IMU JSON (timestamp, accel xyz, gyro xyz)
- 処理: video frame → KLT feature tracking → frame 間 pose 推定 → GTSAM factor graph 構築 → ImuFactor residual 算出
- 出力: per-segment consistency score (residual norm / Mahalanobis distance)

### Phase 2: 実撮影 vs 画面撮影の比較

- 実撮影データ: スマホを手に持って家事をしている映像 + IMU
- 画面撮影データ: 同じ映像をディスプレイに表示し、別のスマホで撮影 + その端末の IMU
- 両者の residual 分布を比較し、分離可能か確認

### Phase 3: 攻撃耐性の確認

- 攻撃者が画面撮影中に端末を意図的に動かした場合の residual
- 静止した三脚撮影 (IMU ≈ 0, 映像も動き少) の場合の residual

## 実装方針

サーバーサイド Python スクリプト。RN アプリとは独立。sandbox 用には mp4 + IMU JSON を input とするCLI ツールとして実装し、consistency score を出力する。

## 完了条件

- [ ] GTSAM + OpenCV KLT で mp4 + IMU JSON → consistency score が算出できる
- [ ] 実撮影データで residual が低い (整合) ことを確認
- [ ] 画面撮影データで residual が高い (不整合) ことを確認
- [ ] 両者の分布に有意な差があることを定量的に示す

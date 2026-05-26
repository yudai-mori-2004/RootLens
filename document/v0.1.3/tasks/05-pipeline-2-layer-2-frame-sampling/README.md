# タスク 05: Pipeline 2 第 2 層 (フレームサンプリング画像解析、 15 点)

## 目的

署名済 MP4 から n_frame 秒ごとに 1 フレームを抽出し、 4 つの画像処理指標を Modal CPU で算出する。 30 分クリップを n=3 で 600 フレーム、 数十秒・$0.01 未満。 映像として使える品質かを確認する。

## 読むべきファイル

### 仕様
1. `document/v0.1.3/DATA_SPECS_JA.md` §3.2.2 第 2 層: フレームサンプリング解析 + §3.2.4 第 2 層内訳

### 既存 OpenCV pattern 参考
2. `server/modal/blur.py` L223-314 `process_mp4` ─ ffmpeg pipe in / cv2 frame loop pattern (= blur 文脈だが frame iterate の流れは参考)
3. `pipeline/video-imu-consistency/verify.py` ─ KLT optical flow の OpenCV 使用例 (= task 07 のサンプル、 ここではフローカウントだけ取れば十分)

## 指標と配点

| 指標 | 配点 | 計算方法 |
|---|---|---|
| brightness_in_range_ratio | 4 | 各フレームのグレースケール平均輝度を計算、 40..240 範囲内のフレーム割合 × 4 |
| sharpness_pass_ratio | 4 | 各フレームのラプラシアン分散 (= `cv2.Laplacian(gray, cv2.CV_64F).var()`) を計算、 閾値 (= 初期値 100) 以上のフレーム割合 × 4 |
| optical_flow_pass_ratio | 4 | 連続するサンプルフレーム間の Farneback フローを計算、 平均フロー量が閾値 (= 初期値 1.0 px) 以上のフレーム割合 × 4 |
| frame_diversity | 3 | サンプルフレーム間のヒストグラム差分 (= 256-bin HSV のチ二乗距離) の平均を閾値で正規化 (= 0 全フレーム同一、 1 十分な変化) × 3 |

**合計 15 点**。 layer2Score は四捨五入した整数。

各閾値は運用データ次第で調整。 初期値は仕様 §3.2.4 に書いた値を採用。

## スコープ

### やること

1. **Modal app**: `rootlens-layer2-frame-sampling` (= CPU 4 cores / 2 GB / timeout 180s)
2. **入力**: `content_id` + `sample_interval_sec` (= default 3) を query string で受け、 R2 から `raw/<content_id>/rgb.mp4` を download
3. **フレーム抽出**: `cv2.VideoCapture` で MP4 を開き、 fps を取得、 `int(fps * sample_interval_sec)` 間隔で frame を読む。 fps が取れない MP4 では `fps=30` を仮定
4. **計算ロジック** (= Python + opencv-python-headless + numpy):
   - 全サンプルフレームを 1 パスで読み、 numpy 配列に集める (= 600 フレーム × 1920×1080 BGR で約 3 GB、 メモリ厳しければ chunk 処理)
   - 各指標を計算
   - Layer2Score JSON を返す
5. **出力**:
   ```json
   {
     "score": 13,
     "brightnessInRangeRatio": 0.94,
     "sharpnessPassRatio": 0.88,
     "opticalFlowPassRatio": 0.71,
     "frameDiversity": 0.65
   }
   ```
6. **冪等性**: 同じ content_id + sample_interval_sec で同じ結果

### やらないこと

- 全フレーム解析 (= サンプリングのみ)
- VLM 呼び出し (= task 06)
- フレーム保存 / 永続化 (= 一時メモリのみ)
- HDR / 色空間補正 (= sRGB 前提)

## 成功基準

- [ ] `modal deploy` 後、 サンプル MP4 で Layer2Score JSON が返る
- [ ] 全 4 指標が 0..1 にクリップされる
- [ ] score は 0..15 の整数
- [ ] サンプル間隔が 3s, 10s, 30s で結果が変わる (= サンプリング動作が正しい)
- [ ] 真っ暗な映像 / 真っ白な映像で brightness_in_range_ratio が 0 になる
- [ ] 全フレーム同一画像で frame_diversity が 0 / optical_flow_pass_ratio が 0 になる
- [ ] 5 秒 640×480 の MP4 で 10 秒以内に完了 (= mock CLI の小サイズ出力で smoke test)
- [ ] 30 分 1080p の MP4 で 60 秒以内に完了 (= 本番想定サイズ)
- [ ] `v0.1.3/server/lib/modal.ts::callFrameSampling` から呼び出せる

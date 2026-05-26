# タスク 04: Pipeline 2 第 1 層 (メタデータ解析、 20 点)

## 目的

`sensors.jsonl` + `imu_high_rate.jsonl` のみで算出可能な 6 指標を Modal CPU 関数で計算する。 映像ファイルをデコードしないので最速・最安 (= 30 分クリップで $0.001 未満)。 技術的にまともなデータかの最低限の足切り。

## 読むべきファイル

### 仕様
1. `document/v0.1.3/DATA_SPECS_JA.md` §3.2.1 第 1 層: メタデータ解析 + §3.2.4 第 1 層内訳

### v0.1.2 流用元 (= 構造のみ、 logic は書き直し)
2. `server/lib/quality.ts` (123 行) ─ JSONL parse pattern、 R2 GET pattern、 frameGapCount 計算ロジック (L60-66)
3. `server/modal/blur.py` の Modal app 設定 + R2 download pattern (= 別 logic だが Modal Secret 取り回しの参考)

### Pipeline 1 出力スキーマ
4. `document/v0.1.3/DATA_SPECS_JA.md` §2.2 ─ sensors.jsonl + imu_high_rate.jsonl のフィールド構造
5. (実装 task 02 後) `v0.1.3/server/scripts/mock_device/` の出力 schema ─ mock CLI が書く JSONL の実際の形

## 指標と配点

| 指標 | 配点 | 計算方法 |
|---|---|---|
| hand_landmark_presence_both | 6 | sensors.jsonl 内で両手 (= 21x2 = 42 ランドマーク全て) が検出されたフレームの割合 (= 0..1) × 6 |
| rgb_sensor_sync_ratio | 4 | sensors.jsonl 内で有効な `timestamp` + `frame_index` を持つ行の割合 × 4 |
| frame_continuity | 4 | 0..N-1 のフレーム番号列における連続性 (= 1 - 欠番率) × 4 |
| tracking_quality | 3 | ARKit `tracking_state == 2` (= normal) のフレーム割合 × 3 |
| hand_movement | 2 | 手首ランドマーク位置のフレーム間変位の分散を閾値で正規化 (= 0 静止 / 1 十分な動き) × 2 |
| imu_gravity_compliance | 1 | 加速度センサーの重力ベクトル norm が 9.81 ± 0.5 m/s² 範囲のフレーム割合 × 1 |

**合計 20 点**。 layer1Score は四捨五入した整数。

## スコープ

### やること

1. **Modal app**: `rootlens-layer1-metadata` (= CPU 2 cores / 1 GB / timeout 60s)
2. **入力**: `content_id` を query string で受け、 R2 から `raw/<content_id>/sensors.jsonl` + `imu_high_rate.jsonl` を download
3. **計算ロジック** (= Python、 標準 ライブラリ + numpy):
   - JSONL stream parse (= 1 行ずつ json.loads、 メモリ効率)
   - 各指標を計算
   - 各指標を 0..1 に正規化してから配点を掛ける
   - Layer1Score JSON を返す
4. **出力**:
   ```json
   {
     "score": 18,
     "handLandmarkPresenceBoth": 0.95,
     "rgbSensorSyncRatio": 1.0,
     "frameContinuity": 0.98,
     "trackingQuality": 0.92,
     "handMovement": 0.6,
     "imuGravityCompliance": 0.88
   }
   ```
5. **冪等性**: 同じ content_id に対して同じ結果を返す (= 入力が決定論的なので自然に成立)

### やらないこと

- 映像ファイルのデコード (= task 05 以降)
- VLM 呼び出し (= task 06)
- depth/ の解析 (= 本フェーズでは未使用)
- 各層スコアの統合 (= task 03 の workflow で行う)
- 棄却閾値の適用 (= 仕様で棄却なし)

## 成功基準

- [x] `modal deploy server-v0.1.3/modal/layer1_metadata.py` が成功し、 web endpoint が公開される
- [x] サンプル sensors.jsonl + imu_high_rate.jsonl (= mock CLI 出力) で Layer1Score JSON が返る
- [x] 全 6 指標が 0..1 にクリップされ、 NaN にならない
- [x] score は 0..20 の整数、 全 sub-metric が float
- [x] 空ファイル / 不完全なファイル (= 1 行だけ等) で例外を吐かず、 各指標を 0 で返す
- [x] 30 分の本物サイズ JSONL (= 100Hz × 1800s = 180,000 行 imu、 30fps × 1800 = 54,000 行 sensors) で 5 秒以内に完了
- [x] `v0.1.3/server/lib/modal.ts::callMetadataScore` から呼び出して同じ JSON が得られる (= task 03 と疎通)

## 進捗 (2026-05-26)

- ✅ Modal app `rootlens-layer1-metadata` を deploy (= POST endpoint、 CPU 2 / 1 GB / 60s)
- ✅ production smoke (= 5 秒 dummy sensor 入力) で `score=18/20` を返した:
    - handLandmarkPresenceBoth=1.0、 rgbSensorSyncRatio=1.0、 frameContinuity=1.0、 trackingQuality=1.0、 imuGravityCompliance=1.0
    - handMovement=0 (= 静止データの理論限界、 想定通り)

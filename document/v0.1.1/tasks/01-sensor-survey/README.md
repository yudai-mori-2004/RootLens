# Task 01: 各 OS のセンサー API レスポンス schema 調査

## 目的

v0.1.1 で導入する「撮影時センサーデータ取得 + C2PA assertion 同梱」の前提として、
iOS / Android 各プラットフォームの **depth / IMU 関連 API が何を返すか** を網羅し、
RootLens が C2PA assertion に「そのまま埋め込むべきフィールド」を確定する。

実装は本タスクの範囲外。アウトプットは **API endpoint 列挙 + 返り値 schema カタログ** であり、
後続タスクで「アプリは OS が返した値を判定・分類せず、そのまま記録する」方針を実現するための一次資料。

## 設計思想 (本タスクで前提にするもの)

本タスクは以下の思想に基づく。後続タスク全体でこの思想が貫徹される。

### 思想 1: Don't be the judge

RootLens は判定機構を持たない。**OS が返す API レスポンスを誠実に記録するレイヤー** である。
「これは sensor」「これは ML 合成」「これは raw」「これは fused」のような分類は RootLens の責任ではない。
判定を持つと、新 OS / 新機種で API 体系が変わったときに「マッピングテーブルを更新する負債」が雪だるま式に積もる。

→ 帰結: tier ラベル (T0/T1/I0 等の独自符号) は **作らない**。
本 APPENDIX は API endpoint 名と返り値 schema をそのまま列挙する。

### 思想 2: All meaning lives off-chain in cNFT data

cNFT のオフチェーンデータが意味の本拠地。
そこに **RootLens が新しく作った/決めた符号** は入らない。入るのは **デバイスが端末から返した情報そのまま**。
意味付け (これは LiDAR 系か、ToF 系か、視差系か) は consumer / TP Extension / 検証側の責任。

### 思想 3: Sensor is the architecture core, camera is one of them

撮影セッションは「センサー群を並列起動して同期取得する」抽象であり、カメラは複数センサーの一つ。
カメラフレームワークを土台に他センサーを「付随」させる設計は、カメラ中心の歪みが負債として残る。
v0.1.1 はこの抽象を新規実装する (Plan C: AVCaptureSession / Camera2 / CMMotionManager / SensorManager をフラット並列で扱う) 。

### 思想 4: 信頼モデルは既存の cert チェーンに依存

スプーフィング耐性は既存の device cert チェーン (Android Key Attestation / iOS App Attest 由来の TEE 鍵) のみに依存する。
センサーデータ単体に対する追加の耐改竄機構は v0.1.1 では設けない。
機種情報 (model / brand / OS) もアプリが `expo-device` 等で取得する自己申告で、その出力をそのまま assertion に同梱する。

## 仕様書参照

v0.1.1 の仕様書は本タスクと並行して起こし中。本タスクは以下の仕様ドラフトに基づく:

- §3.3.3 深度マップデータ (撮影時に物理的に取得できる場合に C2PA に同梱、平面率による偽コンテンツ除外の判断材料として公開)
- §3.3.4 その他のセンサーデータ (IMU・GPS等、PhysicalAI / ロボット用途の学習データとしての価値付け)

v0.1.0 仕様書からの参照:

- §4.5 C2PA マニフェスト構造 (新規 assertion を追加する余地)
- §6.3 Title Protocol Extension (新 Extension の追加余地)

## 実装内容

### Phase 1: iOS depth 関連 API の列挙と返り値 schema 把握 — COMPLETED

`AVDepthData`, `ARDepthData`, `AVCaptureDepthDataOutput`, `AVCameraCalibrationData` の取得経路と返り値プロパティを APPENDIX 第 2 節に記載。

### Phase 2: Android depth 関連 API の列挙と返り値 schema 把握 — COMPLETED

Camera2 `ImageFormat.DEPTH16` / `DEPTH_POINT_CLOUD` / `DEPTH_JPEG`, ARCore `Frame.acquireDepthImage16Bits` / `acquireRawDepthImage16Bits`, `Config.DepthMode` の取得経路と返り値構造を APPENDIX 第 3 節に記載。

### Phase 3: iOS IMU 関連 API の列挙と返り値 schema 把握 — COMPLETED

`CMMotionManager` (各 raw API), `CMDeviceMotion` (融合済み姿勢), `CMBatchedSensorManager` (iOS 17+), `CMAltimeter` の取得経路と返り値プロパティを APPENDIX 第 4 節に記載。

### Phase 4: Android IMU 関連 API の列挙と返り値 schema 把握 — COMPLETED

`SensorManager` の `Sensor.TYPE_*` 各種 (TYPE_ACCELEROMETER, TYPE_GYROSCOPE, TYPE_GYROSCOPE_UNCALIBRATED, TYPE_LINEAR_ACCELERATION, TYPE_GRAVITY, TYPE_ROTATION_VECTOR, TYPE_GAME_ROTATION_VECTOR, TYPE_MAGNETIC_FIELD, TYPE_PRESSURE, TYPE_STEP_COUNTER, TYPE_STEP_DETECTOR) と HAL タイムスタンプ仕様を APPENDIX 第 5 節に記載。

### Phase 5: 後続タスクへの論点列挙 — COMPLETED

API レスポンスをそのまま埋め込む方針を踏まえ、後続タスクで決定する論点を APPENDIX 第 6 節に整理。

## スコープ外 (後続タスク)

- 抽象センサー層 IF 設計 / ネイティブ実装 (Task 02 以降)
- C2PA assertion への実際の埋め込み (Task 02-04)
- 動画 (Task 03)
- Depth 取得実装 (Task 04)
- ライブプレビュー UI (Task 05)
- TP Extension WASM 実装 + 公開ページ (Task 06)
- API レスポンスの **詳細 schema 確定** (公式 SDK ヘッダ・実機実測ベース) は各実装タスクの中で並列エージェント調査で補強する

## 完了条件

- [x] iOS depth API endpoint 一覧と返り値プロパティの記載
- [x] Android depth API endpoint 一覧と返り値構造の記載
- [x] iOS IMU API endpoint 一覧と返り値プロパティの記載
- [x] Android IMU API endpoint 一覧と返り値構造の記載
- [x] 設計思想 (Don't be the judge / API レスポンスそのまま記録) を README に明記
- [x] 後続タスクへの論点引渡し

## 完了日: 2026-04-26

## ディレクトリ構成

```
document/v0.1.1/tasks/01-sensor-survey/
├── README.md                       # 本ファイル
└── APPENDIX-sensor-coverage.md     # OS API レスポンス schema カタログ
```

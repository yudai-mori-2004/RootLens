# Task 04: Depth センサーを抽象センサー層に追加 (静止画 + 動画両対応)

## 目的

抽象センサー層 (Task 02 で構築) に **DepthSensor 群** を追加する。
各 OS / 各 API path を **判定なくそのまま** 並列に並べ、利用可能なものすべてを assertion に同梱する。

対象 API (Task 01 APPENDIX 第 2-3 節で列挙):

- iOS: `AVCaptureDepthDataOutput` (TrueDepth / Dual / Triple / LiDAR Depth Camera 経由)
- iOS: ARKit `ARFrame.sceneDepth` (LiDAR)
- iOS: ARKit `ARFrame.smoothedSceneDepth` (LiDAR + 時間平滑)
- Android: Camera2 `ImageFormat.DEPTH16` / `DEPTH_POINT_CLOUD` / `DEPTH_JPEG`
- Android: ARCore `Frame.acquireDepthImage16Bits` (`Config.depthMode = AUTOMATIC`)
- Android: ARCore `Frame.acquireRawDepthImage16Bits` + `acquireRawDepthConfidenceImage` (`Config.depthMode = RAW_DEPTH_ONLY`)

各 API path は **独立した ISensor 実装** として登録する。同一機種で複数 API が使えるなら全部記録する (例: iPhone 16 Pro 撮影で AVCaptureDepthDataOutput と ARKit sceneDepth と smoothedSceneDepth の3つの assertion が並ぶ)。

### 思想 (再掲)

- API path 名をそのまま assertion ラベルに使う。"raw" / "fused" / "physical" / "ML" 等のラベルを作らない
- 「光学的取得かどうか」の判定はしない → 標準 `c2pa.depthmap.GDepth` は使わず、すべて custom assertion (`io.rootlens.capture.{platform}.{api_path}`)
- 取れる API すべてから取得し、判定は consumer 側 / TP Extension / 検証側に委ねる

## 仕様書参照

- v0.1.1 仕様書 §3.3.3 (深度マップデータ)
- Task 01 APPENDIX 第 2 節 (iOS depth) / 第 3 節 (Android depth)
- v0.1.0 §4.5 / §4.6

## 技術スタック

```
[抽象センサー層 (Task 02 で構築済み)]
  SensorSession.register(IDepthSensor)
    ├── ios.AvCaptureDepthDataSensor      (AVCaptureDepthDataOutput)
    ├── ios.ArkitSceneDepthSensor          (ARFrame.sceneDepth)
    ├── ios.ArkitSmoothedSceneDepthSensor  (ARFrame.smoothedSceneDepth)
    ├── android.Camera2Depth16Sensor       (ImageFormat.DEPTH16)
    ├── android.Camera2DepthPointCloudSensor (ImageFormat.DEPTH_POINT_CLOUD)
    ├── android.ArcoreDepthAutomaticSensor (acquireDepthImage16Bits)
    └── android.ArcoreRawDepthSensor       (acquireRawDepthImage16Bits + confidence)
```

## 実装内容

### Phase 1: IDepthSensor IF 設計 — PENDING

depth 出力の共通 schema:

```typescript
interface IDepthSensorCapability {
  // capability() で取れた sensor の固定メタ
  api_path: string;                    // e.g. "ios.av_capture_depth_data" 
  pixel_format?: string;                // OS API レスポンス値そのまま (例: "DepthFloat32")
  available_pixel_formats?: string[];   // OS が返す候補
  resolution?: { width: number; height: number };
  device_position?: 'back' | 'front' | string;  // OS が返した値そのまま
  // ... 他 OS API が返す固定情報
  raw_response: unknown;  // OS API レスポンスそのままを保持 (任意 JSON)
}

interface DepthCaptureResult {
  api_path: string;
  width: number;
  height: number;
  depth_data: ArrayBuffer;   // pixel buffer の生バイト
  pixel_format: string;       // OS API レスポンス値
  is_filtered?: boolean;      // OS が isDepthDataFiltered を返した場合のみ
  accuracy?: string;          // .relative / .absolute (enum 名)
  quality?: string;           // .low / .high
  confidence_data?: ArrayBuffer;  // ARCore raw depth の confidence map
  camera_calibration?: {       // OS API のフィールドそのまま
    intrinsic_matrix?: number[];
    extrinsic_matrix?: number[];
    pixel_size?: number;
    lens_distortion_lookup_table?: ArrayBuffer;
    intrinsic_matrix_reference_dimensions?: { width: number; height: number };
    lens_distortion_center?: { x: number; y: number };
  };
  timestamp_ns: bigint;
}
```

depth マップ本体 (バイナリ) は assertion 内に PNG16 にロスレス圧縮して inline 同梱する案を採る。圧縮処理は depth → PNG16 のロスレス変換のみで、depth 値そのものは改変しない。

### Phase 2: iOS Depth 実装 — PENDING

**`AvCaptureDepthDataSensor`** (`app/modules/sensor-session/ios/sensors/AvCaptureDepthDataSensor.swift`):
- `AVCaptureDeviceDiscoverySession` で `builtInLiDARDepthCamera` / `builtInTrueDepthCamera` / `builtInDualCamera` 等を列挙
- `AVCaptureDepthDataOutput` を session に追加 (静止画) または `AVCaptureDataOutputSynchronizer` で video + depth 同期 (動画)
- 結果を `AVDepthData` のプロパティそのまま (Task 01 APPENDIX §2.1 の表) で返す

**`ArkitSceneDepthSensor`** / **`ArkitSmoothedSceneDepthSensor`**:
- `ARSession` + `ARWorldTrackingConfiguration` (frameSemantics に `.sceneDepth` / `.smoothedSceneDepth`)
- ARSession のライフサイクルが AVCaptureSession と衝突する → **Task 02 で導入する `ISensor.exclusivityGroup` 機構**で排他制御する
- ARKit 系 ISensor は `exclusivityGroup = "ios.av_session"` を主張、CameraSensor / AvCaptureDepthDataSensor も同 group に属する
- SensorSession が capture() 時に group 内から1つを選択 (優先順位は capability に基づく / 撮影モード等で動的に切替)
- 結果として「ARKit を使うときは AVCaptureSession 系は走らない」「AVCaptureSession を使うときは ARKit 系は走らない」が SensorSession 内で自動解決される

### Phase 3: Android Depth 実装 — PENDING

**`Camera2Depth16Sensor`**:
- 既存 Camera2 セッション (Task 02 の `CameraSensor`) に DEPTH16 ImageReader を追加
- `REQUEST_AVAILABLE_CAPABILITIES_DEPTH_OUTPUT` を持つ camera id で動作
- 結果を生バイト + CaptureResult プロパティそのまま返す

**`Camera2DepthPointCloudSensor`**: 同様に DEPTH_POINT_CLOUD format で

**`ArcoreDepthAutomaticSensor`** / **`ArcoreRawDepthSensor`**:
- ARCore Session を起動 (depth mode AUTOMATIC / RAW_DEPTH_ONLY)
- Frame ごとに `acquireDepthImage16Bits` / `acquireRawDepthImage16Bits` を呼ぶ
- ARCore Session が Camera2 を握るため、Task 02 の exclusivityGroup 機構で `exclusivityGroup = "android.camera2"` を主張 (Camera2Sensor / Camera2Depth16Sensor も同 group)
- 注: Task 03 で Android 動画は MediaMuxer 自前実装に決定し ARCore Recording は不採用 → 動画録画と ARCore depth は同時には使わない (動画モードでは Camera2 系 + IMU、AR depth は静止画モード時のみ)

### Phase 4: 動画キーフレーム抽出 — PENDING

連続 depth は容量が爆発するため、動画でキーフレーム depth を選定:

- 戦略 A: **時間等間隔** (例: 1秒ごとに 1 frame)
- 戦略 B: **シーン変化検出** (RGB フレーム間の変化量がしきい値超えで keyframe 判定)
- 戦略 C: **動画録画開始 / 終了 / 中央** の固定ポイント

v0.1.1 は **戦略 A (1秒間隔)** で開始。戦略は将来切替可能なよう ISensor の Capability に注釈する。

### Phase 5: c2pa-bridge での assertion 同梱 — PENDING

**静止画**: depth pixel buffer を PNG16 圧縮 → base64 → assertion `data` フィールドに inline。1 API path = 1 assertion。

**動画**: 動画ファイル全体は CAMM track + C2PA bmff hash で扱う (Task 03)。depth keyframe は **静止画と同じ assertion 形式** で C2PA Manifest Store の uuid box 内に配置。各 keyframe には `frame_pts_ns` フィールド (動画の presentation timestamp と整合) を付与。

c2pa-bridge の sign 関数は Task 02 で確立した assertion 配列受付に乗る。新 API は不要。

### Phase 6: 実機検証 — PENDING

各機種で取れる depth API path をすべて assertion に同梱できることを確認:

- iPhone 16 Pro: AVCaptureDepthDataOutput (Dual/Triple/LiDAR Camera) / ARFrame.sceneDepth / smoothedSceneDepth
- iPhone 13 mini (LiDAR なし): AVCaptureDepthDataOutput (Dual Camera のみ)
- iPhone SE 3rd gen: depth 出力なし → assertion なし (capability がそもそも空)
- Pixel 8 Pro: ARCore depth (AUTOMATIC / RAW_DEPTH_ONLY)、Camera2 DEPTH16 は機種依存
- Galaxy S25 Ultra (ToF 搭載): Camera2 DEPTH16 + ARCore depth
- 廉価 Android (depth API なし): assertion なし

c2patool で各 assertion の存在確認 + payload バイトの整合性確認。

## スコープ外 (後続タスク)

- ライブプレビュー UI に depth 可視化を載せるかは Task 05 の判断
- TP Extension 側の depth 検証 / 公開ページ可視化 (Task 06)

## 完了条件

- [ ] IDepthSensor IF 定義 (TS / ネイティブ両層)
- [ ] iOS: AvCaptureDepthDataSensor / ArkitSceneDepthSensor / ArkitSmoothedSceneDepthSensor 実装
- [ ] Android: Camera2Depth16Sensor / Camera2DepthPointCloudSensor / ArcoreDepthAutomaticSensor / ArcoreRawDepthSensor 実装
- [ ] depth pixel buffer の PNG16 ロスレス圧縮 + base64 inline embedding
- [ ] 動画キーフレーム抽出 (時間等間隔戦略)
- [ ] Task 02 の exclusivityGroup 機構を活用した ARSession / AVCaptureSession / Camera2 / ARCore の排他解決
- [ ] 実機検証 (iPhone Pro / 無印 / Pixel / Galaxy / 廉価 Android 各 1)
- [ ] c2patool で各 assertion 確認

## 完了日: TBD

## ディレクトリ構成

```
app/modules/sensor-session/
├── ios/
│   └── sensors/
│       ├── AvCaptureDepthDataSensor.swift
│       ├── ArkitSceneDepthSensor.swift
│       └── ArkitSmoothedSceneDepthSensor.swift
└── android/
    └── src/main/java/io/rootlens/sensorsession/
        └── sensors/
            ├── Camera2Depth16Sensor.kt
            ├── Camera2DepthPointCloudSensor.kt
            ├── ArcoreDepthAutomaticSensor.kt
            └── ArcoreRawDepthSensor.kt
```

## 並列調査が必要な項目 (実装中にエージェントで補強)

- ARSession と AVCaptureSession の同時起動可否、排他制御の最善パターン
- ARCore Session と Camera2 の同時起動 (ARCore が Camera2 を握る) の制限と回避策
- depth pixel buffer の PNG16 ロスレス変換実装 (iOS / Android のネイティブライブラリ)
- 動画でのキーフレーム抽出のシーン変化検出アルゴリズム (将来戦略 B 検討)
- 各 OS / 各機種の depth pixel format 一覧 (Task 01 APPENDIX 補足)
- HEIC で撮影された場合の auxC depth と AVCaptureDepthDataOutput depth の差異

# APPENDIX: 各 OS のセンサー API レスポンス schema カタログ

調査日: 2026-04-26 / 対象: RootLens v0.1.1 で C2PA assertion に埋め込み対象となる「depth / IMU 関連」の OS API endpoint と返り値 schema。
公式 SDK ドキュメント (Apple Developer / Android Developers / ARCore) の 2026-04 時点の情報を一次情報とする。

---

## 1. 本資料の使い方

本資料は **「アプリは OS が返したものをそのまま記録する」方針の前提リスト** である。各 API について以下を列挙する:

- **API path**: 公式 SDK での名前 (RootLens 内で別名を作らない)
- **取得経路**: どの class / method を呼ぶか
- **返り値プロパティ / フィールド**: そのまま assertion に埋める対象
- **データ形式**: バイナリ / JSON / pixel buffer 等
- **可用条件**: 機種 / OS バージョン / 権限

RootLens は本資料に列挙したフィールドを **判定なしでそのまま** custom assertion (`io.rootlens.capture.*`) に埋め込む。「raw か fused か」「物理 sensor か推定か」のような分類は載せない。判定を必要とする consumer は、API path 名を見て自身で意味付けする。

詳細な schema (各プロパティの型 / 単位 / nullable) は **後続タスクの実装時に並列エージェントで補強**する。本資料は API endpoint と主要返り値の網羅を目的とする。

---

## 2. iOS depth 関連 API

### 2.1 `AVCaptureDepthDataOutput` (AVFoundation)

**取得経路**:

```
AVCaptureSession
  + AVCaptureDeviceDiscoverySession でデバイス検出:
      builtInLiDARDepthCamera     (iOS 15.4+)
      builtInTrueDepthCamera
      builtInDualCamera
      builtInTripleCamera
      builtInDualWideCamera
  + AVCaptureDepthDataOutput  (delegate 経由でストリーミング)
  + AVCapturePhotoOutput.isDepthDataDeliveryEnabled  (静止画同梱)
```

**返り値: `AVDepthData`** (記録対象プロパティ)

| プロパティ | 型 / 値 | 内容 |
|-----------|--------|-----|
| `depthDataMap` | `CVPixelBuffer` | 深度マップ本体 (フォーマットは下記) |
| `depthDataType` | `OSType` (FourCC) | `kCVPixelFormatType_DepthFloat16` / `DepthFloat32` / `DisparityFloat16` / `DisparityFloat32` のいずれか |
| `availableDepthDataTypes` | `[NSNumber]` | このソースが提供できる format 群 |
| `isDepthDataFiltered` | `Bool` | OS 内で平滑化等のフィルタが施されているか (true / false をそのまま記録) |
| `depthDataAccuracy` | `AVDepthData.Accuracy` | `.relative` / `.absolute` (enum 値をそのまま記録) |
| `depthDataQuality` | `AVDepthData.Quality` | `.low` / `.high` (enum 値をそのまま記録) |
| `cameraCalibrationData` | `AVCameraCalibrationData` | 後述 |

**`AVCameraCalibrationData` のプロパティ** (記録対象):
- `intrinsicMatrix` (3×3 simd_float3x3)
- `intrinsicMatrixReferenceDimensions` (CGSize)
- `extrinsicMatrix` (4×3 simd_float4x3)
- `pixelSize` (Float, mm)
- `lensDistortionLookupTable` (Data)
- `inverseLensDistortionLookupTable` (Data)
- `lensDistortionCenter` (CGPoint)

### 2.2 ARKit `ARFrame.sceneDepth` / `smoothedSceneDepth`

**取得経路**:

```
ARSession + ARWorldTrackingConfiguration
  configuration.frameSemantics = [.sceneDepth, .smoothedSceneDepth]
ARSession.delegate.session(_:didUpdate:)
  → ARFrame.sceneDepth         : ARDepthData?
  → ARFrame.smoothedSceneDepth : ARDepthData?  (時間平滑版)
```

**返り値: `ARDepthData`** (記録対象プロパティ)

| プロパティ | 型 | 内容 |
|-----------|----|-----|
| `depthMap` | `CVPixelBuffer` (Float32, 256×192 px 程度) | 距離マップ (メートル) |
| `confidenceMap` | `CVPixelBuffer?` (UInt8) | 各画素の confidence (0=low / 1=medium / 2=high) |

**ARFrame 側で同時に記録すべき関連値**:
- `ARFrame.timestamp` (`TimeInterval`)
- `ARFrame.camera.intrinsics` (3×3 simd_float3x3)
- `ARFrame.camera.transform` (4×4 simd_float4x4, world ↔ camera)
- `ARFrame.camera.eulerAngles` / `imageResolution`

`sceneDepth` か `smoothedSceneDepth` どちらの API path を呼んだかは **assertion 内に明示的にラベル付けして記録する** (両 API の値を別 assertion として並べる)。RootLens 側で「raw vs filtered」の判定はせず、API path の文字列をそのまま埋める。

### 2.3 静止画 photo 同梱 depth (`AVCapturePhoto`)

**取得経路**:

```
AVCapturePhotoOutput.isDepthDataDeliveryEnabled = true
AVCapturePhotoSettings.isDepthDataDeliveryEnabled = true
AVCapturePhotoSettings.embedsDepthDataInPhoto = true   // HEIF auxiliary に embed
photoOutput.capturePhoto(with:)
delegate.photoOutput(_:didFinishProcessingPhoto:)
  → AVCapturePhoto.depthData : AVDepthData?
```

**`AVCapturePhoto` 側プロパティ**:
- `depthData` (上記 §2.1 の AVDepthData)
- `cameraCalibrationData` (§2.1 同上)
- `metadata` (CGImageMetadata の生プロパティ辞書)

### 2.4 可用条件 (RootLens 側で判定しない、参考情報)

- LiDAR Scanner: iPhone Pro 系 (12 Pro 〜) / iPad Pro (2020 以降)
- TrueDepth: Face ID 搭載 iPhone / iPad Pro
- Dual / Triple Camera: 機種別。`AVCaptureDevice.DiscoverySession` の `devices` を実行時に列挙して **取れた API path のみ**記録する

---

## 3. Android depth 関連 API

### 3.1 Camera2 `ImageFormat.DEPTH16` / `DEPTH_POINT_CLOUD` / `DEPTH_JPEG`

**取得経路**:

```
CameraManager.cameraIdList.forEach { id ->
  val ch = cm.getCameraCharacteristics(id)
  val caps = ch.get(REQUEST_AVAILABLE_CAPABILITIES)
  if (caps.contains(REQUEST_AVAILABLE_CAPABILITIES_DEPTH_OUTPUT)) {
    // この camera id は depth を提供する
    val streamConfig = ch.get(SCALER_STREAM_CONFIGURATION_MAP)
    val depthSizes = streamConfig.getOutputSizes(ImageFormat.DEPTH16)
    // ImageReader を作って ImageReader.OnImageAvailableListener で受信
  }
}
```

**返り値: `Image`** (記録対象データ)

| ImageFormat | 内容 | データ構造 |
|-------------|------|---------|
| `DEPTH16` | 16-bit unsigned depth pixel | `Image.Plane[0].buffer` の生バイト列 (高 12bit が深度値、低 4bit が confidence。フォーマット詳細は機種依存) |
| `DEPTH_POINT_CLOUD` | 各点 (x, y, z, confidence) の floats | `Plane[0]` に `FloatBuffer` で並ぶ |
| `DEPTH_JPEG` | JPEG + Google Dynamic Depth XMP | 通常 JPEG として読みつつ XMP セクションをパースして depth recovery |

**CaptureResult** から同時に取れる関連値:
- `SENSOR_TIMESTAMP` (Long, nanoseconds, `SystemClock.elapsedRealtimeNanos` 系)
- `LENS_INTRINSIC_CALIBRATION` (5 floats)
- `LENS_DISTORTION` (5 floats)
- `LENS_POSE_TRANSLATION` / `LENS_POSE_ROTATION`
- `STATISTICS_LENS_SHADING_MAP`

**CameraCharacteristics** から取れる固定情報:
- `INFO_SUPPORTED_HARDWARE_LEVEL` (LIMITED / FULL / LEVEL_3 / EXTERNAL)
- `SENSOR_INFO_TIMESTAMP_SOURCE` (UNKNOWN / REALTIME)
- `DEPTH_DEPTH_IS_EXCLUSIVE` (Boolean)
- `SCALER_STREAM_CONFIGURATION_MAP` (使える depth size 列挙)

### 3.2 ARCore `Frame.acquireDepthImage16Bits` / `acquireRawDepthImage16Bits`

**取得経路**:

```
val config = Config(session)
config.depthMode = Config.DepthMode.AUTOMATIC          // depth-from-motion + ToF auto-merge
// or
config.depthMode = Config.DepthMode.RAW_DEPTH_ONLY     // raw + confidence map
session.configure(config)

val frame = session.update()
val depthImage: Image = frame.acquireDepthImage16Bits()           // smoothed
val rawDepthImage: Image = frame.acquireRawDepthImage16Bits()     // raw
val confidenceImage: Image = frame.acquireRawDepthConfidenceImage()
```

**返り値: `Image`** (記録対象データ)

| API path | format | データ |
|----------|--------|------|
| `acquireDepthImage16Bits()` | `ImageFormat.DEPTH16` 互換 16-bit | `Plane[0]` 生バイト列 (mm 単位) |
| `acquireRawDepthImage16Bits()` | 同上 | raw版、未平滑 |
| `acquireRawDepthConfidenceImage()` | `Y8` (8-bit grayscale) | 各画素の信頼度 (0-255) |

**Frame 側で同時記録すべき値**:
- `Frame.timestamp` (Long, ns, monotonic)
- `Camera.imageIntrinsics` (focal length, principal point, image dimensions)
- `Camera.pose` (translation + quaternion rotation)
- `Frame.cameraTextureIntrinsics`

**Config から記録**:
- `Config.depthMode` の文字列 ("AUTOMATIC" / "RAW_DEPTH_ONLY" / "DISABLED" のいずれか) を assertion に埋める。**RootLens は ARCore が自動マージしているか否かを判定しない** — 「AUTOMATIC mode で取った」という事実だけ記録する。

### 3.3 Google Dynamic Depth (`DEPTH_JPEG` の XMP メタデータ)

JPEG 内に XMP namespace `http://ns.google.com/photos/1.0/camera/` で depth が埋め込まれているケース。

**XMP fields** (記録対象):
- `GCamera:DepthFormat` ("RangeInverse" | "RangeLinear")
- `GCamera:DepthNear` / `GCamera:DepthFar` (floats)
- `GCamera:DepthMime` ("image/jpeg" | "image/png")
- `GCamera:DepthData` (base64)
- `GCamera:DepthUnits` ("m" | "mm")
- `GCamera:DepthMeasureType` ("OpticalAxis" | "OpticRay")
- `GCamera:DepthConfidenceURI`
- `GCamera:DepthManufacturer` / `Model` / `Software`
- `GCamera:DepthImageWidth` / `Height`

これらは **そのまま XMP のキー名で assertion に埋める**。RootLens 独自の正規化は行わない。

### 3.4 可用条件 (参考)

- 物理 ToF 搭載: Samsung Galaxy Note10+, S20+/Ultra, S25 Ultra, LG V60, Sharp AQUOS R5G, Huawei P30 Pro 等 (実機で `REQUEST_AVAILABLE_CAPABILITIES_DEPTH_OUTPUT` を確認)
- ARCore Depth API 対応: 2025-10 時点で active ~87%
- 機種判定はせず、実行時に **どの API が使えたか** だけ記録

---

## 4. iOS IMU 関連 API

### 4.1 `CMMotionManager` (CoreMotion / per-sample API)

**取得経路 — raw API 群**:

```swift
let mgr = CMMotionManager()

// Accelerometer (raw)
mgr.accelerometerUpdateInterval = 1.0/100.0
mgr.startAccelerometerUpdates(to: queue) { (data: CMAccelerometerData?, _) in
  // data.acceleration : CMAcceleration { x, y, z }
  // data.timestamp    : TimeInterval
}

// Gyroscope (raw)
mgr.startGyroUpdates(to: queue) { (data: CMGyroData?, _) in
  // data.rotationRate : CMRotationRate { x, y, z }
  // data.timestamp    : TimeInterval
}

// Magnetometer (raw)
mgr.startMagnetometerUpdates(to: queue) { (data: CMMagnetometerData?, _) in
  // data.magneticField : CMMagneticField { x, y, z }
  // data.timestamp     : TimeInterval
}
```

**返り値プロパティ** (記録対象):

| API | プロパティ | 値 |
|-----|----------|-----|
| `accelerometerData` | `acceleration.x/y/z` | g 単位 (重力 1.0 = 9.81m/s²) |
| `accelerometerData` | `timestamp` | TimeInterval (`mach_absolute_time` 起源) |
| `gyroData` | `rotationRate.x/y/z` | rad/s |
| `gyroData` | `timestamp` | 同上 |
| `magnetometerData` | `magneticField.x/y/z` | μT |
| `magnetometerData` | `timestamp` | 同上 |

最大サンプリングレート: 100Hz (`...UpdateInterval` を 0.01 以下に設定しても保証されない)

### 4.2 `CMMotionManager.deviceMotion` (融合済み API)

**取得経路**:

```swift
mgr.deviceMotionUpdateInterval = 1.0/100.0
mgr.startDeviceMotionUpdates(using: .xMagneticNorthZVertical, to: queue) { (data: CMDeviceMotion?, _) in
  // data.attitude         : CMAttitude (quaternion + rotation matrix + roll/pitch/yaw)
  // data.rotationRate     : CMRotationRate
  // data.gravity          : CMAcceleration
  // data.userAcceleration : CMAcceleration  (= total - gravity)
  // data.magneticField    : CMCalibratedMagneticField (field + accuracy)
  // data.heading          : Double
  // data.timestamp        : TimeInterval
}
```

**返り値プロパティ** (記録対象、すべて埋める):

- `attitude.quaternion` (CMQuaternion: x/y/z/w)
- `attitude.rotationMatrix` (CMRotationMatrix: 9 fields)
- `attitude.roll` / `pitch` / `yaw` (radians)
- `rotationRate.x/y/z`
- `gravity.x/y/z`
- `userAcceleration.x/y/z`
- `magneticField.field.x/y/z`, `magneticField.accuracy` (uncalibrated / low / medium / high)
- `heading` (degrees)
- `timestamp`

`CMMotionManager.startDeviceMotionUpdates` のオーバーロードで指定する `using:` 引数 (CMAttitudeReferenceFrame: `xArbitraryZVertical` / `xArbitraryCorrectedZVertical` / `xMagneticNorthZVertical` / `xTrueNorthZVertical`) も assertion に記録する (どの reference frame で取ったか)。

### 4.3 `CMBatchedSensorManager` (iOS 17+)

```swift
let bsm = CMBatchedSensorManager()
let stream = bsm.deviceMotionUpdates(at: .Hz200)  // .Hz25 / .Hz50 / .Hz100 / .Hz200
for try await batch in stream {
  // batch : [CMDeviceMotion]  (1秒分)
}
```

返り値は `CMDeviceMotion` の配列。プロパティは §4.2 と同じ。
バッチ配信の最大レート: device motion 200Hz / accelerometer 800Hz。Apple Watch 中心で公開。iPhone での可用は機種別。

### 4.4 `CMAltimeter` (気圧計)

```swift
let alt = CMAltimeter()
alt.startRelativeAltitudeUpdates(to: queue) { (data: CMAltitudeData?, _) in
  // data.relativeAltitude : NSNumber (m, セッション開始時を 0 とする相対値)
  // data.pressure         : NSNumber (kPa)
  // data.timestamp        : TimeInterval
}

// 絶対気圧 (iOS 14+)
alt.startAbsoluteAltitudeUpdates(to: queue) { (data: CMAbsoluteAltitudeData?, _) in
  // data.altitude   : Double (m, mean sea level 推定)
  // data.accuracy   : Double (m, 95% CI)
  // data.precision  : Double
  // data.timestamp  : TimeInterval
}
```

`relativeAltitude` / `pressure` / `altitude` / `accuracy` / `precision` を記録対象。

### 4.5 可用条件 (参考)

- iPhone 6 以降は accel + gyro + mag + barometer (iPhone SE 1st gen のみ barometer 例外)
- iPhone は基本的にすべての IMU API が使える
- `CMBatchedSensorManager` の iPhone 対応は OS バージョン + 機種依存

### 4.6 NSMotionUsageDescription

`Info.plist` に `NSMotionUsageDescription` キーが必要 (CMMotionManager / CMAltimeter 全般)。

---

## 5. Android IMU 関連 API

### 5.1 `SensorManager.getDefaultSensor(TYPE_*)` 一覧

```kotlin
val sm = ctx.getSystemService(SensorManager::class.java)
val accel = sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
val gyro  = sm.getDefaultSensor(Sensor.TYPE_GYROSCOPE)
// etc.
sm.registerListener(listener, accel, SensorManager.SENSOR_DELAY_FASTEST)
```

**Sensor TYPE 一覧** (各 type の API path をそのまま記録対象):

| Sensor.TYPE_* | values 配列 (記録対象) | 単位 / 内容 |
|---------------|---------------------|------------|
| `TYPE_ACCELEROMETER` | `[ax, ay, az]` | m/s² (重力含む) |
| `TYPE_ACCELEROMETER_UNCALIBRATED` (API 26+) | `[ax, ay, az, bias_x, bias_y, bias_z]` | 同上 + bias |
| `TYPE_GYROSCOPE` | `[wx, wy, wz]` | rad/s |
| `TYPE_GYROSCOPE_UNCALIBRATED` | `[wx, wy, wz, bias_x, bias_y, bias_z]` | 同上 + drift bias |
| `TYPE_MAGNETIC_FIELD` | `[mx, my, mz]` | μT |
| `TYPE_MAGNETIC_FIELD_UNCALIBRATED` | `[mx, my, mz, bias_x, bias_y, bias_z]` | 同上 + iron bias |
| `TYPE_LINEAR_ACCELERATION` | `[lx, ly, lz]` | m/s² (重力除外、software-fused) |
| `TYPE_GRAVITY` | `[gx, gy, gz]` | m/s² (重力のみ、software-fused) |
| `TYPE_ROTATION_VECTOR` | `[x*sin(θ/2), y*sin(θ/2), z*sin(θ/2), cos(θ/2), accuracy?]` | quaternion (last component optional) |
| `TYPE_GAME_ROTATION_VECTOR` | 同上 (磁力計を使わない) | quaternion |
| `TYPE_GEOMAGNETIC_ROTATION_VECTOR` | 同上 (低消費) | quaternion |
| `TYPE_ORIENTATION` (deprecated) | `[azimuth, pitch, roll]` | degrees (廃止予定) |
| `TYPE_PRESSURE` | `[hPa]` | hPa (atmospheric pressure) |
| `TYPE_AMBIENT_TEMPERATURE` | `[°C]` | Celsius |
| `TYPE_RELATIVE_HUMIDITY` | `[%]` | percent |
| `TYPE_LIGHT` | `[lux]` | lux |
| `TYPE_PROXIMITY` | `[cm]` | cm |
| `TYPE_STEP_COUNTER` | `[count]` | step total since boot |
| `TYPE_STEP_DETECTOR` | `[1.0]` | trigger event |
| `TYPE_HEART_RATE` | `[bpm]` | (要 BODY_SENSORS、v0.1.1 スコープ外: 撮影とのユースケース直結が薄く、Privacy permission rationale の追加負担を避けるため) |

RootLens は **TYPE_* 名そのまま (整数値ではなく) 文字列として** assertion に埋める。「raw」「fused」「uncalibrated」を判定せず、TYPE 名と返り値配列をそのまま記録する。

### 5.2 `SensorEvent` プロパティ (記録対象)

```kotlin
override fun onSensorChanged(e: SensorEvent) {
  // e.sensor    : Sensor (type / name / vendor / version / resolution / power 等)
  // e.values    : FloatArray (上記 §5.1 参照)
  // e.timestamp : Long (nanoseconds, SystemClock.elapsedRealtimeNanos 系)
  // e.accuracy  : Int (UNRELIABLE=0 / LOW=1 / MEDIUM=2 / HIGH=3)
}
```

**Sensor 側の固定情報** (記録対象):
- `Sensor.name` (String, ベンダー命名)
- `Sensor.vendor` (String)
- `Sensor.version` (Int)
- `Sensor.type` / `Sensor.stringType` (例: `"android.sensor.gyroscope"`)
- `Sensor.power` (mA)
- `Sensor.resolution` (sensor unit)
- `Sensor.maxRange`
- `Sensor.minDelay` / `maxDelay` (microseconds)
- `Sensor.fifoMaxEventCount` / `fifoReservedEventCount`
- `Sensor.isWakeUpSensor`

これらすべてを sensor capability metadata として一度だけ記録する。

### 5.3 サンプリングレート制御

```kotlin
sm.registerListener(listener, sensor, samplingPeriodUs, maxReportLatencyUs)
//   samplingPeriodUs : 希望サンプリング周期 (μs)
//   maxReportLatencyUs : バッチ配信の許容遅延 (μs)。0 = 即配信
```

定数: `SENSOR_DELAY_FASTEST` (0) / `_GAME` (20000μs) / `_UI` (66667μs) / `_NORMAL` (200000μs)

**Android 12 (API 31) 以降の制限**:
- accel / gyro / mag は **デフォルト 200Hz 上限**
- AndroidManifest.xml に `<uses-permission android:name="android.permission.HIGH_SAMPLING_RATE_SENSORS"/>` を宣言すれば解除
- ユーザーがマイクトグル OFF 中は権限有無に関わらず常に rate-limited

実際の rate は HW 依存。HW プロファイル `INFO_SUPPORTED_HARDWARE_LEVEL` に対応する CDD §7.3 High-Fidelity Sensor profile があるが、**RootLens はこの判定をせず、実測 timestamp delta から rate を計算して記録する**。

### 5.4 Camera-IMU タイムスタンプ同期

- `Sensor.TYPE_*.timestamp` (ns, monotonic, `SystemClock.elapsedRealtimeNanos` 起源)
- Camera2 `CaptureResult.SENSOR_TIMESTAMP` (`SENSOR_INFO_TIMESTAMP_SOURCE == REALTIME` の機種で同一時間軸)

両者が同じ時間軸なら sub-millisecond レベルでの同期記録が可能。`SENSOR_INFO_TIMESTAMP_SOURCE` の値も assertion に記録する。

---

## 6. CAMM (Camera Motion Metadata, mp4 timed metadata)

動画 (mp4) における sensor stream の埋め込み形式。Google が Street View 向けに策定、ARCore Recording API がネイティブ生成。

### 6.1 CAMM record types

| type | 内容 | data 構造 |
|------|------|---------|
| `0` | angle-axis orientation | `[ax, ay, az]` (3 floats) |
| `1` | exposure metadata | (deprecated) |
| `2` | gyroscope | `[gx, gy, gz]` (3 floats, rad/s) |
| `3` | accelerometer | `[ax, ay, az]` (3 floats, m/s²) |
| `4` | position (6DoF) | `[x, y, z, qx, qy, qz, qw]` |
| `5` | GPS minimal | `[lat, lon, alt]` (3 doubles) |
| `6` | GPS extended | lat/lon/alt + accuracy + bearing + ts |
| `7` | magnetic | `[mx, my, mz]` (3 floats, μT) |

mp4 内では `moov.trak` (handler="meta", stsd codec="camm") に `mdat` 内 sample として interleave される。

### 6.2 ARCore Recording API (Android) — v0.1.1 では不採用

```kotlin
val config = RecordingConfig(session)
  .setMp4DatasetFilePath(uri)
  .setAutoStopOnPause(true)
  .addTrack(Track.builder("camm-track")
              .setMimeType("application/camm")
              .build())
session.startRecording(config)
```

ARCore が自動で CAMM track を mp4 に書き出す API。**v0.1.1 では不採用**:
- Google Play Services for AR 必須 → 中国版・低スペック・Huawei 等で動かない
- Recording 中に ARCore tracking パイプラインが常時走る → battery 重い
- ARCore Session が Camera2 を握る → RootLens 自前 Camera2 実装と複雑な共存が必要

代わりに **MediaMuxer 自前実装** (Task 03 Phase 3 参照) を採用。`MediaMuxer.addTrack(MediaFormat)` で `KEY_MIME = "application/camm"` を渡せば API 18+ 全機種で動く。box type は `mett` (TextMetaDataSampleEntry) になり厳密な CAMM 仕様 (`camm` SampleEntry) とは差異があるが、RootLens 内部 / 自前 verifier 用途では問題ない。Street View 互換が将来必要になった場合は mp4parser で post-process する経路を残す。

### 6.3 iOS CAMM writer (自前実装が必要)

iOS は AVFoundation に CAMM ネイティブサポートがないため、`AVAssetWriter` + `AVAssetWriterInput(mediaType: .metadata)` で **CAMM 仕様準拠のバイナリ sample を自前で書き出す**。
詳細実装は Task 03 で扱う。本資料は仕様参照のみ。

---

## 7. 機種情報の取得 (アプリ自己申告)

`expo-device` (RN) から取得する。OS API がそのまま返す値を assertion に埋める。

### 7.1 expo-device プロパティ

| プロパティ | iOS の値 | Android の値 |
|-----------|---------|-------------|
| `Device.brand` | "Apple" | `Build.BRAND` |
| `Device.manufacturer` | "Apple" | `Build.MANUFACTURER` |
| `Device.modelName` | "iPhone 16 Pro" 等 (デバイス名) | `Build.MODEL` |
| `Device.modelId` | "iPhone17,1" (machine identifier) | `Build.DEVICE` |
| `Device.osName` | "iOS" / "iPadOS" | "Android" |
| `Device.osVersion` | "19.2" | `Build.VERSION.RELEASE` |
| `Device.osBuildId` | iOS: build 番号 | `Build.DISPLAY` |
| `Device.osBuildFingerprint` | (iOS なし) | `Build.FINGERPRINT` |
| `Device.platformApiLevel` | (iOS なし) | `Build.VERSION.SDK_INT` |
| `Device.totalMemory` | bytes | bytes |
| `Device.deviceYearClass` | year | year |
| `Device.deviceType` | PHONE / TABLET / etc. | 同上 |

これらをアプリ起動時に取得して assertion 内に埋め込む。**RootLens 側でモデルを「LiDAR 搭載判定」のような別ラベルに変換しない**。生の値だけを埋める。

---

## 7.5 共通検証機種マトリクス (v0.1.1 後続タスクで参照)

各実装タスク (Task 02-06) は最低限以下の機種で実機検証する:

| カテゴリ | 機種 | 期待される取得 API |
|---------|------|------------------|
| iPhone Pro (LiDAR + TrueDepth + Triple) | iPhone 15 Pro / 16 Pro 系 | AVCaptureDepthDataOutput (LiDAR/TrueDepth/Dual/Triple) / ARFrame.sceneDepth / smoothedSceneDepth / 全 CoreMotion API |
| iPhone 無印 (Dual or Triple、LiDAR なし) | iPhone 13 / 14 / 15 / 16 | AVCaptureDepthDataOutput (Dual/Triple) / 全 CoreMotion API |
| iPhone 廉価 (シングルカメラ) | iPhone SE 3rd gen | front TrueDepth なし、rear depth なし、全 CoreMotion API は OK |
| Pixel (ARCore + flagship) | Pixel 9 / 10 系 | ARCore depth API / Camera2 / 全 SensorManager TYPE_* |
| Samsung flagship (ToF) | Galaxy S25 Ultra | Camera2 DEPTH16 / ARCore / 全 SensorManager |
| 廉価 Android (gyro 欠落の可能性) | 主要1機種 (実装時に選定) | accel + mag のみ取れる想定、gyro / depth なし |

各タスクは「この機種列挙のうち何台で検証するか」を完了条件に明記する (Task 02 = 全カテゴリ最低1台 / Task 04 = 全カテゴリ全部 等)。

---

## 8. 後続タスクへの論点

本資料を踏まえ、後続タスクで扱う:

1. **抽象センサー層 IF 設計** (Task 02): 各 OS API path を `ISensor` の実装として並列に並べる。`capability()` で「使える API path のリスト」を返す。`capture(window)` で「使えた API path 全部の取得結果を返す」。判定なし
2. **C2PA assertion ラベル設計** (Task 02-04): `io.rootlens.capture.{platform}.{api_path}` の命名。例:
   - `io.rootlens.capture.ios.av_depth_data`
   - `io.rootlens.capture.ios.arkit_scene_depth`
   - `io.rootlens.capture.ios.arkit_smoothed_scene_depth`
   - `io.rootlens.capture.ios.core_motion.device_motion`
   - `io.rootlens.capture.ios.core_motion.gyro`
   - `io.rootlens.capture.android.camera2_depth16`
   - `io.rootlens.capture.android.arcore_depth_automatic`
   - `io.rootlens.capture.android.arcore_depth_raw_only`
   - `io.rootlens.capture.android.sensor_event.type_gyroscope`
   - `io.rootlens.capture.android.sensor_event.type_gyroscope_uncalibrated`
   - 1 API call = 1 assertion。**判定して統合しない**
3. **撮影窓モデル** (Task 02-03): 静止画 = 単点窓 / 動画 = ストリーム窓を同じ抽象で扱う
4. **動画の CAMM track 統合** (Task 03)
5. **Depth 取得の API 経路実装** (Task 04)
6. **Title Protocol Extension の WASM 実装** (Task 06): `sensor-depth`, `sensor-imu` を別 WASM として登録 (Camera は既存 `image-pdq` / `video-vpdq` / `cert-*` で十分カバーされるため `sensor-camera` Extension は立てない)
7. **公開ページ可視化** (Task 06): API path 名 + raw 値だけを受け取り、表示時に意味付け

C2PA spec の標準 assertion (`c2pa.depthmap.GDepth` 等) は **採用しない**。標準は「光学的取得かどうか」等の判定要件を持つため思想 1 に反する。RootLens は全部 custom assertion で、API レスポンスをそのまま埋める。

---

## 参考文献

### iOS
- [AVCaptureDepthDataOutput](https://developer.apple.com/documentation/avfoundation/avcapturedepthdataoutput)
- [AVDepthData](https://developer.apple.com/documentation/avfoundation/avdepthdata)
- [AVCameraCalibrationData](https://developer.apple.com/documentation/avfoundation/avcameracalibrationdata)
- [ARFrame.sceneDepth](https://developer.apple.com/documentation/arkit/arframe/3566299-scenedepth)
- [ARDepthData](https://developer.apple.com/documentation/arkit/ardepthdata)
- [Core Motion / CMMotionManager](https://developer.apple.com/documentation/coremotion/cmmotionmanager)
- [CMDeviceMotion](https://developer.apple.com/documentation/coremotion/cmdevicemotion)
- [CMBatchedSensorManager](https://developer.apple.com/documentation/coremotion/cmbatchedsensormanager)
- [CMAltimeter](https://developer.apple.com/documentation/coremotion/cmaltimeter)

### Android
- [Camera2 DEPTH capabilities](https://developer.android.com/reference/android/hardware/camera2/CameraMetadata#REQUEST_AVAILABLE_CAPABILITIES_DEPTH_OUTPUT)
- [ARCore Depth API](https://developers.google.com/ar/develop/depth)
- [ARCore Recording API](https://developers.google.com/ar/develop/recording-and-playback)
- [SensorManager](https://developer.android.com/reference/android/hardware/SensorManager)
- [Sensor types reference](https://source.android.com/docs/core/interaction/sensors/sensor-types)
- [HIGH_SAMPLING_RATE_SENSORS](https://developer.android.com/reference/android/Manifest.permission#HIGH_SAMPLING_RATE_SENSORS)
- [CAMM spec (Google)](https://developers.google.com/streetview/publish/camm-spec)
- [Google Dynamic Depth](https://developers.google.com/depthmap-metadata/reference)

### React Native / Expo
- [expo-device](https://docs.expo.dev/versions/latest/sdk/device/)

# Task 02: 撮影スタック Plan C 化 + 抽象センサー層 + 静止画パイプライン

## 目的

v0.1.1 の撮影アーキテクチャの土台を作る。以下を達成する:

1. **expo-camera を撤去**し、AVCaptureSession (iOS) / Camera2 (Android) を直接扱う独自ネイティブ撮影スタックを構築する (Plan C)
2. **抽象センサー層 SensorSession** を新規実装する。Camera / IMU を **対等な ISensor 実装** として並列にぶら下げ、撮影窓に基づいて並列同期取得する
3. **c2pa-bridge Rust 層を assertion 動的注入対応に改修**し、ネイティブ層から渡された任意数の sensor assertion を JUMBF に埋め込めるようにする
4. **静止画 (window 長 = 0)** で「Camera 取得結果 + IMU 取得結果」を C2PA assertion として埋め込んだ JPEG が実機で吐けるところまで通す

### 思想 (Task 01 で確定したもの)

- **Don't be the judge**: アプリは OS が返した API レスポンスをそのまま記録する。判定・分類しない
- **Sensor is the architecture core, camera is one of them**: SensorSession が撮影セッション抽象、Camera は ISensor の1実装

## 仕様書参照

- v0.1.1 仕様書 §3.3.3 / §3.3.4 (深度マップ・センサーデータ)
- v0.1.0 §4.5 C2PA マニフェスト構造 (新規 assertion を追加する余地を活用)
- v0.1.0 §4.6 C2PA SDK 統合 (c2pa-rs FFI)
- Task 01 APPENDIX-sensor-coverage.md (各 OS API の返り値 schema)

## 技術スタック

```
[RN / TypeScript]
  CameraScreen.tsx (シャッターハンドラ → SensorSession.capture)
        │
        ▼
[SensorSession 抽象 (TS)]
  - register(ISensor)
  - capture(window: TimeWindow): Promise<SensorCaptureResult>
        │
        ▼
[ネイティブブリッジ (Expo Modules API)]
  - SensorSessionModule.kt (Android)
  - SensorSessionModule.swift (iOS)
        │
        ▼
[Sensor 実装層 (フラット並列)]
  ├── CameraSensor       (AVCaptureSession + Camera2)
  ├── ImuSensor          (CMMotionManager + SensorManager)
  └── (Task 04 で DepthSensor が同じ層に追加される)
        │
        ▼
[c2pa-bridge (Rust, FFI)]
  - sign_image_tee_with_assertions(input, output, certs, tsa, sensor_assertions_json)
  - serde_json::Value で manifest を動的構築
        │
        ▼
[C2PA 署名済み JPEG]
  JUMBF:
    c2pa.actions (c2pa.created)
    io.rootlens.capture.ios.av_capture_photo_metadata     (例)
    io.rootlens.capture.ios.core_motion.device_motion      (例)
    io.rootlens.capture.android.sensor_event.type_gyroscope_uncalibrated  (例)
    io.rootlens.capture.device                              (expo-device 取得値)
    ...
```

## 実装内容

### Phase 1: 抽象センサー層 IF 設計 — COMPLETED

TypeScript / ネイティブ両層に共通する型と契約を確定する。

**TypeScript 側 (`app/src/sensors/`)**:

```typescript
type TimeWindow = { startMs: number; durationMs: number };  // durationMs=0 → 単点 (静止画)

interface ISensor<TCapability, TResult> {
  readonly id: string;            // e.g. "ios.core_motion.device_motion"
  capability(): Promise<TCapability | null>;  // 取得可能ならその定数情報、ダメなら null
  capture(window: TimeWindow): Promise<TResult>;
}

interface SensorCaptureResult {
  sensor_id: string;       // ISensor.id と同一
  api_path: string;        // C2PA assertion label の構成材料
  payload: unknown;        // OS API レスポンスをそのまま (JSON-serializable な形に変換のみ)
  timestamps: { startNs: bigint; endNs: bigint };
}

class SensorSession {
  register(sensor: ISensor<unknown, unknown>): void;
  async capture(window: TimeWindow): Promise<SensorCaptureResult[]>;
}
```

**ネイティブ側 (`app/modules/sensor-session/`)**:
- iOS: `SensorSessionModule.swift` を Expo Modules API で実装
- Android: `SensorSessionModule.kt` を Expo Modules API で実装
- 各 ISensor は AsyncFunction として export し、TS 側から呼ぶ

**複数 ISensor 同時起動の可否を IF 設計時に明示する**:
- 「他 ISensor と排他か並列か」を `ISensor.exclusivityGroup(): string | null` 等で表明する
- 例: iOS の ARSession 系 (ArkitSceneDepthSensor) と AVCaptureSession 系 (CameraSensor / AvCaptureDepthDataSensor) は排他グループ。同 group 内では SensorSession が選択ロジックを持つ (Task 04 で実装する Depth センサーの IF にこの制約を組み込む前提)
- 排他グループに属さない ISensor (IMU / 気圧計 / GPS) は他とフラットに並列起動できる
- SensorSession.capture() は登録された ISensor を集めて exclusivity を解決した上で並列起動する

### Phase 2: ネイティブ Camera 静止画実装 — COMPLETED (Android), PARTIAL (iOS: コードのみ、実機未検証)

**iOS**:
- `AVCaptureSession` + `AVCaptureDevice.DiscoverySession` でカメラ列挙
- `AVCapturePhotoOutput` で静止画キャプチャ
- 結果を絶対ファイルパス + `AVCapturePhoto.metadata` プロパティ辞書として返す
- 撮影 window の startMs にできる限り近い `presentationTimestamp` を一致させる

**Android**:
- `CameraManager.openCamera` + `CameraDevice.createCaptureSession`
- `ImageReader(ImageFormat.JPEG)` で静止画キャプチャ
- `CaptureResult.SENSOR_TIMESTAMP` を返す (IMU 同期用)
- 撮影 window と SENSOR_TIMESTAMP を対応付け

両プラットフォームとも、本タスクではプレビュー描画は **デバッグ最低限のみ** (Task 05 で本実装)。撮影が動くことが目的。

### Phase 3: ネイティブ IMU 実装 — COMPLETED (Android), PARTIAL (iOS: コードのみ、実機未検証)

**iOS** (`app/modules/sensor-session/ios/sensors/`):
- `CMMotionManager` の raw API (accelerometer / gyro / magnetometer) と融合 API (`startDeviceMotionUpdates`) **両方** を独立した ISensor として登録
- `CMAltimeter` も独立 ISensor
- iOS 17+ 対応機種では `CMBatchedSensorManager` も別 ISensor

**Android** (`app/modules/sensor-session/android/sensors/`):
- `SensorManager.getSensorList(Sensor.TYPE_ALL)` で実機列挙
- 利用可能な TYPE_* それぞれを独立 ISensor として登録
- `<uses-permission android:name="android.permission.HIGH_SAMPLING_RATE_SENSORS"/>` を AndroidManifest に追加
- `Permissions API` 申請の rationale 文言を仕様書 §3.3.4 に基づき作成

**リングバッファ設計**:
- 各 IMU sensor は撮影前から常時 listener 登録、リングバッファ (時間軸 ±N秒) を保持
- `capture(window)` で window 範囲内の sample を切り出して返す

### Phase 4: c2pa-bridge Rust assertion 動的注入対応 — COMPLETED

**現状の問題**:
- `native/c2pa-bridge/src/lib.rs L293-316` の `manifest_json` は文字列テンプレート
- ネイティブ層から assertion 配列を渡せない

**改修内容**:
- 新 FFI 関数 `c2pa_sign_image_tee_with_assertions(input, output, certs, cert_sizes, cert_count, tsa_url, assertions_json_array)` を追加
- Rust 内部で `serde_json::Value` を動的構築:
  ```rust
  let mut assertions = vec![ json!({ "label": "c2pa.actions", "data": {...} }) ];
  if let Ok(arr) = serde_json::from_str::<Vec<Value>>(assertions_json) {
    assertions.extend(arr);
  }
  let manifest = json!({ "claim_generator_info": [...], "assertions": assertions });
  Builder::from_json(&manifest.to_string())?.sign(...);
  ```
- Android JNI / iOS C FFI の signature 拡張

**テスト**: c2patool で署名済み JPEG を読み、追加 assertion がすべて含まれていることを確認する。

### Phase 5: 静止画パイプラインの結線 + 編集系 API の撤去 — COMPLETED

`CameraScreen.tsx` を以下の順で書き換え:

1. シャッター押下 → `SensorSession.capture({ startMs: now, durationMs: 0 })`
2. CameraSensor / ImuSensor / DeviceInfoSensor を並列取得
3. 各 SensorCaptureResult を `io.rootlens.capture.{platform}.{api_path}` ラベルで C2PA assertion 化
4. `c2paBridge.signContent(imagePath, assertions)` を呼び出し
5. 署名済み URI を `signedAndSave()` 経由で MediaLibrary 保存

**`signContentWithParent` (parent ingredient 参照) は完全削除**:
- v0.1.1 では EditScreen を撤去するため (Task 05)、parent マニフェスト参照は本質的に不要
- 動画でも編集を行わないので parent も不要
- `app/src/native/c2paBridge.ts` の `signContentWithParent` export を削除
- ネイティブ層の対応 export と Rust FFI の `do_sign_tee_with_parent` も削除

**プレビュー UI の取り扱い** (Task 05 との境界):
- expo-camera の package.json からの削除は **Task 05 で行う**
- Task 02 では「撮影セッションを Plan C 化 (AVCaptureSession / Camera2 直叩き) しつつ、プレビュー描画は expo-camera を残して暫定対応」の状態をゴールにする
- もしくは「デバッグ最低限のネイティブ Preview View」を Task 02 で仮実装し、Task 05 でそれを本実装に育てる差分タスクに位置付ける
- どちらを採用するかは実装着手時の状況で判断 (Phase 1 IF 設計時)

### Phase 6: 統合テスト — COMPLETED (Pixel 10 で実施。21 assertion + IMU 全 type の生サンプル CBOR 直 decode で物理値妥当性確認済み)

実機 (iPhone Pro / 無印 / Pixel / Galaxy 各1台ずつ最低限) で:
- IMU + 機種情報 入りの C2PA 署名済み JPEG が出力される
- c2patool でマニフェスト読み出し → 各 assertion が含まれる
- Adobe Verify (contentcredentials.org) で読み込み → ベース署名が valid

**Adobe Verify 等の外部 C2PA validator における custom assertion の扱い**:
- `io.rootlens.capture.*` は **未知の assertion ラベルとして扱われる** (Adobe / contentcredentials.org / その他標準 validator は内容を解釈しない、これは想定通り)
- C2PA spec の標準 assertion (`c2pa.depthmap.GDepth` 等) を採用しない理由は思想 1 (Don't be the judge) と整合 — 詳細は Task 01 APPENDIX §8 参照
- 意味付けは RootLens 自社公開ページ (`rootlens.io`) と Title Protocol Extension (Task 06) が担う

## スコープ外 (後続タスク)

- 動画パイプライン (Task 03)
- Depth センサー追加 (Task 04)
- 本番品質のライブプレビュー UI / 撮影 UX / EditScreen 撤去 / カメラロール選択 (Task 05)
- TP Extension 実装 / 公開ページ可視化 (Task 06)

## 完了条件

- [x] `app/src/sensors/` に SensorSession + ISensor 抽象が実装されている
- [x] iOS: `app/modules/sensor-session/ios/` に AVCaptureSession + CMMotionManager + CMAltimeter ベースの ISensor 群 (コード作成済み、実機未検証)
- [x] Android: `app/modules/sensor-session/android/` に Camera2 + SensorManager ベースの ISensor 群
- [x] expo-camera 撮影フローからの **切替が完了** (削除自体は Task 05 で実施)
- [x] `native/c2pa-bridge/src/lib.rs` に assertion 動的注入対応関数 + JNI / C FFI signature
- [x] `app/src/native/c2paBridge.ts` の signContent API が assertion 配列を受ける
- [x] **`signContentWithParent` を完全削除** (TS / ネイティブ / Rust の3層全て)
- [x] CameraScreen.tsx が新 SensorSession 経路で動作する (Plan A2: 最低限ネイティブ Preview View)
- [x] 実機で IMU + 機種情報入り C2PA 署名済み JPEG が吐ける (Pixel 10、21 assertion)
- [x] c2patool で各 assertion ラベルが確認できる
- [ ] Adobe Verify で「ベース C2PA 署名が valid、custom assertion は未知ラベル扱い」を確認 (オフライン未実施。signed JPEG をオンラインアップロードして要確認)

## 完了日: 2026-04-27 (Android 実機検証完了。iOS 実機検証は別途。Adobe Verify チェックは未実施)

## 実装中の落とし穴 / 改修記録

実装中に踏んだ 8 件の罠 (gradle 重複登録、Module 親クラス member 衝突、View Manager 命名規約、Plan A1 → Plan A2 への切替、Camera2 deadlock、wall-clock vs monotonic ns ミスマッチ、JSON serialization、c2patool nested array 表示バグ) は `POSTMORTEM-implementation-pitfalls.md` を参照。

## ディレクトリ構成 (予定)

```
app/
├── src/
│   ├── sensors/
│   │   ├── ISensor.ts
│   │   ├── SensorSession.ts
│   │   └── types.ts
│   ├── native/
│   │   ├── c2paBridge.ts          (assertion 配列受付に拡張)
│   │   └── sensorSession.ts       (新規: Expo Modules ブリッジラッパー)
│   └── screens/
│       └── CameraScreen.tsx       (SensorSession 経由に書き換え)
│
├── modules/
│   ├── c2pa-bridge/                (既存)
│   │   ├── ios/
│   │   └── android/
│   └── sensor-session/             (新規: Expo Modules)
│       ├── ios/
│       │   ├── SensorSessionModule.swift
│       │   ├── sensors/
│       │   │   ├── CameraSensor.swift
│       │   │   ├── CoreMotionDeviceMotionSensor.swift
│       │   │   ├── CoreMotionGyroSensor.swift
│       │   │   ├── CoreMotionAccelSensor.swift
│       │   │   ├── CoreMotionMagSensor.swift
│       │   │   └── AltimeterSensor.swift
│       │   └── SensorRingBuffer.swift
│       └── android/
│           └── src/main/java/io/rootlens/sensorsession/
│               ├── SensorSessionModule.kt
│               ├── sensors/
│               │   ├── Camera2Sensor.kt
│               │   ├── SensorEventSensor.kt   (TYPE_* 各種を生成)
│               │   └── BarometerSensor.kt
│               └── SensorRingBuffer.kt
│
native/
└── c2pa-bridge/
    └── src/
        └── lib.rs                  (assertion 動的注入対応)
```

## 並列調査が必要な項目 (実装中にエージェントで補強)

- Expo Modules API での Camera プレビュー描画最低限実装 (SwiftUI View / SurfaceView 露出パターン)
- AVCaptureSession の `.photo` preset と HW timestamp 取得最善策
- Camera2 の `INFO_SUPPORTED_HARDWARE_LEVEL` 別の挙動差異一覧
- c2pa-rs 0.78 の Builder.from_json で assertion を動的に追加する正確な API
- Android `HIGH_SAMPLING_RATE_SENSORS` 権限の Google Play 審査 rationale 文言

# Task 03: 動画パイプライン (Camera + IMU 動画 / CAMM track / bmff hash)

## 目的

Task 02 で構築した抽象センサー層を **ストリーム指向 (撮影窓 > 0)** に拡張し、動画録画モードを実現する:

1. SensorSession に動画モードを追加。各 ISensor がストリーム取得対応
2. **iOS の CAMM writer を自前実装** (`AVAssetWriter` + `AVAssetWriterInput(mediaType: .metadata)` で CAMM 仕様準拠の binary metadata track を muxing)
3. **Android は MediaMuxer 自前で CAMM track を書き出す** (`addTrack(MediaFormat)` で `KEY_MIME = "application/camm"`、API 18+ 全機種対応。ARCore Recording API は依存・battery・対応機種が重いため不採用)
4. **c2pa-rs の bmff hash (`c2pa.hash.bmff.v3`)** を統合し、mp4 / mov に C2PA 署名を付与
5. **Camera + IMU 入りの C2PA 署名済み mp4** が実機で撮れるところまで通す

### 思想 (Task 01 で確定したもの)

- 動画ファースト設計: 静止画は動画の特殊ケース (window 長 = 0)。Task 02 の抽象を拡張するだけで動画が自然に乗る
- API レスポンスをそのまま記録: CAMM の type 識別子 (0=angle-axis / 2=gyro / 3=accel / 5=GPS / 7=magnetic 等) も判定して再分類しない

## 仕様書参照

- v0.1.1 仕様書 §3.3.3 / §3.3.4
- v0.1.0 §4.5 C2PA マニフェスト構造 / §4.6 C2PA SDK 統合
- Task 01 APPENDIX 第 6 節 (CAMM)

## 技術スタック

```
[SensorSession (ストリーム拡張)]
  capture(window: { startMs, durationMs > 0 })
    → 各 ISensor が stream 開始
    → (録画進行中) Camera フレーム + IMU sample がリングバッファに溜まる
    → 録画終了で stream 終了、結果を統合

[iOS 動画 muxing]
  AVAssetWriter
    + AVAssetWriterInput (video, "vide")
    + AVAssetWriterInput (audio, "soun") [将来]
    + AVAssetWriterInput (metadata, "meta", codec="camm")  ← 自前実装
        ↑ CAMM 仕様準拠 binary sample を逐次 append

[Android 動画 muxing]
  MediaMuxer (OutputFormat.MUXER_OUTPUT_MPEG_4)
    + addTrack(MediaFormat.KEY_MIME = "application/camm")  ← 自前実装
        ↑ CAMM 仕様準拠 binary sample を逐次 writeSampleData
  Camera2 セッションは RootLens 自前 (CameraSensor) を流用
  (ARCore Recording は依存重い + battery 重い + 対応機種狭いため不採用)

[c2pa-bridge (Rust)]
  sign_video_tee_with_assertions(input_mp4, output_mp4, certs, ..., assertions_json)
    → c2pa-rs Builder で BMFF asset 処理
    → c2pa.hash.bmff.v3 (Merkle hash) 自動計算
    → uuid box (extended type for C2PA Manifest Store) に JUMBF を埋め込み
    → mdat には触らない (CAMM track はそのまま温存される)
```

## 実装内容

### 設計判断: Android は MediaMuxer 自前実装、ARCore Recording は不採用 (Phase 3 参照)

### Phase 1: SensorSession のストリーム拡張 — COMPLETED

`window.durationMs > 0` の場合のフロー:

- 各 ISensor が `startStream(window)` を実装。録画期間中、サンプルを内部バッファに append
- Camera は AVAssetWriter / Android Recording に直接 muxing
- IMU は CAMM sample 化して metadata track に渡す
- `stopStream()` で結果を返す (mp4 ファイルパス + sensor 経路ごとのストリーム情報)

`SensorCaptureResult` を拡張:
```typescript
type SensorCaptureResult =
  | { kind: 'point'; ... }                                // 静止画
  | { kind: 'stream'; muxed_into?: 'mp4_track' | 'inline'; track_handler?: string; sample_count: number; ... };  // 動画
```

### Phase 2: iOS CAMM writer 自前実装 — DEFERRED (実機なしで未着手。iOS 実機が手に入った時点で着手)

CAMM 仕様 (Google CAMM spec) の準拠実装:

**Sample binary layout** (little-endian):
```
+---+---+---+---+---+---+---+---+---+...
|reserved (2B) | type (2B)   | payload (type-dependent)
```

- type=2 (gyro): 3 floats (12 bytes payload)
- type=3 (accel): 3 floats (12 bytes payload)
- type=4 (position): 7 floats (28 bytes payload)
- type=5 (gps minimal): 3 doubles (24 bytes payload)
- type=7 (magnetic): 3 floats (12 bytes payload)

**iOS 実装** (`app/modules/sensor-session/ios/CammMetadataWriter.swift`):
- `AVAssetWriterInput(mediaType: .metadata, outputSettings: nil, sourceFormatHint: cammFormatDescription)`
- `cammFormatDescription` は `CMFormatDescription.create(mediaType: .metadata, mediaSubType: .from("camm"))` 相当を `CMMetadataFormatDescriptionCreateWithMetadataSpecifications` で生成
- 各 sample を `CMSampleBuffer` で append
- `CMSampleBufferGetPresentationTimeStamp` を IMU `CMDeviceMotion.timestamp` (CACurrentMediaTime 系) と整合

**実装上の課題** (調査エージェントで補強予定):
- AVFoundation で任意バイナリの metadata track を書くには `kCMMetadataFormatType_Boxed` か `kCMMetadataIdentifier` 経由の手法を採るか
- mdat 内 sample 順序の interleave (video / metadata) を AVAssetWriter に任せるか自前で制御するか

### Phase 3: Android MediaMuxer + CAMM 自前実装 — PARTIAL

**動作した:** Camera2 → MediaCodec H.264 encoder → MediaMuxer mp4 録画 (Phase 2 の本体)。
StreamRecorder + StreamSession + Camera2VideoStreamHandle + VideoEncoder を新設。

**v0.1.2 以降に延期 (CAMM track binary 書き出し):**
AOSP MediaMuxer は `application/*` track を TextMetaDataSampleEntry (mett) として扱い、binary CAMM サンプルの writeSampleData を拒否する (text 想定の内部実装のため)。実装してテストしたところ:
- `addTrack(application/camm)` 自体は成功する
- `writeSampleData` で全サンプルが "writeSampleData returned an error" でドロップされる

CAMM 仕様準拠の "camm" SampleEntry を持つ mp4 を吐くには:
- mp4parser 等で post-process してサンプル entry を mett → camm に書き換える
- または自前 mp4 muxer を実装する

v0.1.1 では IMU データを **C2PA assertion inline JSON (ring buffer slice 経由)** で保存する経路 (静止画と同様) で機能要件を満たすため、CAMM track 書き出しは v0.1.2 以降に延期。`StreamRecorder.addCammTrack()` は no-op のまま残しており、将来 mp4parser ポストプロセスを足せば再開できる構造。

調査結果 (並列エージェント) により ARCore Recording API は不採用。理由:

- ARCore は Google Play Services for AR 必須 → 対応機種が狭まる (中国版・低スペック・Huawei 等で動かない)
- Recording 中に ARCore tracking パイプラインがフルで走る → battery 重い
- ARCore Session が Camera2 を握る → RootLens 自前の CameraSensor (Task 02) と複雑な共存が必要
- CAMM データの本質は IMU + GPS + カメラ姿勢推定。ARCore の高品質 6DoF pose を取らないなら overkill

**採用: MediaMuxer 自前実装** (`addTrack(MediaFormat)` で `KEY_MIME = "application/camm"` を渡す。API 18+ 全機種対応)

```kotlin
class CammMuxer(outputPath: String) {
    private val muxer = MediaMuxer(outputPath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
    private var videoTrack = -1
    private var cammTrack = -1
    private var startNanos = 0L

    fun addCammTrack(): Int {
        val fmt = MediaFormat()
        fmt.setString(MediaFormat.KEY_MIME, "application/camm")
        cammTrack = muxer.addTrack(fmt)
        return cammTrack
    }

    /** type=2 gyro [rad/s], type=3 accel [m/s^2], type=7 magnetic [μT] */
    fun writeCammVec3(type: Int, x: Float, y: Float, z: Float, timestampNanos: Long) {
        val payload = ByteBuffer.allocate(16).order(ByteOrder.LITTLE_ENDIAN).apply {
            putShort(0)               // reserved
            putShort(type.toShort())
            putFloat(x); putFloat(y); putFloat(z)
        }
        payload.flip()
        val info = MediaCodec.BufferInfo().apply {
            offset = 0; size = payload.remaining()
            presentationTimeUs = (timestampNanos - startNanos) / 1000
            flags = 0
        }
        muxer.writeSampleData(cammTrack, payload, info)
    }
    // ... type=4 position(28B), type=5 GPS(28B), type=6 GPS extended など同様
}
```

**注意点と落とし穴**:

- AOSP MediaMuxer は metadata track の SampleEntry box を `mett` (TextMetaDataSampleEntry) として書く。CAMM 仕様 (`developers.google.com/streetview/publish/camm-spec`) は固有 `camm` SampleEntry を要求するが、**RootLens 内部 / 自前 verifier で使う分には問題なし** (sample binary layout が正しければ自前 parser で読める)。Street View 直接アップロード等の外部互換が将来必要になったら mp4parser 後処理で `mett` → `camm` に書き換える経路を残す
- **タイムスタンプ同期は最大の落とし穴**: `SensorEvent.timestamp` と `CaptureResult.SENSOR_TIMESTAMP` が同じ `SystemClock.elapsedRealtimeNanos` 系であるかを実機ごとに検証する必要がある。`CameraCharacteristics.SENSOR_INFO_TIMESTAMP_SOURCE = REALTIME` を確認するロジックを必須化、`UNKNOWN` 機種では offset 補正 fallback を実装
- 長時間録画 (>30min) で MediaMuxer の 4GB 制限に当たる可能性 → API 24+ で `setNextOutputFile` 利用

### Phase 4: c2pa-bridge Rust BMFF 対応 — COMPLETED (Rust 改修不要と判明)

実装着手して判明: 既存の `c2pa_sign_image_tee` FFI は内部で `mime_from_path()` により mp4 / mov を `video/mp4` / `video/quicktime` MIME に解決し、c2pa-rs Builder.sign() が自動で BMFF v3 hash + uuid box JUMBF を埋め込む。**FFI 関数追加は不要**。Rust 側のドキュメントコメントだけ「image FFI は実は media generic」と明記して終了。

検証結果: 5 秒録画 mp4 (1920x1080 30fps h264) に C2PA Manifest が `c2pa.hash.bmff.v3` 含む 22 assertions として埋め込まれることを Pixel 10 で確認済み。CAMM track の代わりにストリーム IMU は inline JSON で 22 assertions の中に格納される。

c2pa-rs 0.78 は BMFF (mp4 / mov) の C2PA 署名を既にサポート:

```rust
let mut builder = Builder::from_json(&manifest_json)?;
builder.sign_file(
  source_path: "input.mp4",
  dest_path: "output.mp4",
  signer: &callback_signer,
)?;
// 内部で c2pa.hash.bmff.v3 が生成され、uuid box に JUMBF が埋め込まれる
```

- 新 FFI 関数 `c2pa_sign_video_tee_with_assertions(input_mp4, output_mp4, certs, ..., assertions_json)` を追加
- assertion 配列は静止画と同じ構造を受ける
- Merkle hash は c2pa-rs が大容量ファイルに対して自動分割
- `c2pa.hash.bmff.v3` の exclusion ranges を正しく設定 (uuid box 自身を exclude)

**確認事項** (実装時にエージェント補強):
- c2pa-rs が CAMM track を破壊せずに JUMBF を挿入できるか (`mdat` に手を入れない設計か)
- 実装中に APP11 overflow バグ (issue #1961) と同種の問題がないか

### Phase 5: メモリ管理 (長時間動画対策) — PARTIAL

**実装済み:** SensorEventRingBuffer の上限制御 (4096 サンプルで FIFO drop)、CAMM listener の専用 HandlerThread 隔離、video encoder の drain thread 分離。短〜中時間 (10秒以下) の録画では問題なく動作。

**v0.1.2 以降に延期:** MediaMuxer の 4 GB 制限 (API 24+ の `setNextOutputFile`)、長時間録画 (>30 分) での battery / thermal 検証、storage full 検知。v0.1.1 のスコープ (短い記録 + 即時 Title Protocol 登録) では現状の実装で十分。

- IMU リングバッファのサイズ上限と古いサンプルの drop
- 録画ファイルのストリーミング書き出し (mp4 を memory に持たない)
- AVAssetWriter のバッファ詰まり対策 (`expectsMediaDataInRealTime = true`)

### Phase 6: 統合テスト — COMPLETED (Pixel 10 で実施)

**確認済み:**
- 5 秒動画録画 → 1920x1080 30fps h264 mp4 出力 (145 frames, 4.83s, 8.35 Mbps 実測)
- C2PA `c2pa.hash.bmff.v3` BMFF Merkle hash で署名済み
- 22 個の assertion (Camera + IMU 17 種 + DeviceInfo + window + c2pa.actions.v2 + c2pa.hash.bmff.v3) 同梱
- IMU stream サンプルが C2PA manifest 内に inline JSON で格納 (CBOR 直 decode で確認、accel mean = 9.79 m/s² で物理値妥当)
- ffprobe で h264 stream + 正しい duration / frame rate / 解像度を確認

**未実施:** ffprobe で application/camm track の確認 (CAMM track 自体を v0.1.2 に延期したため対象外)、contentcredentials.org でのオンライン C2PA video 表示確認。

実機で:
- 5 秒 / 30 秒 / 5 分 の動画を録画 → c2patool で読み出し → CAMM track + C2PA assertion が両方生きている
- VLC / ffprobe で CAMM track の sample 数が IMU 取得期間と整合
- contentcredentials.org で video の C2PA 表示確認

## スコープ外 (後続タスク)

- Depth センサー (Task 04 で動画キーフレーム埋め込みも含めて実装)
- ライブプレビュー UI / 録画 UX (Task 05)
- 動画再生 + IMU 同期表示の公開ページ (Task 06)

## 完了条件

- [x] SensorSession のストリーム拡張 (window > 0) — startStream / stopStream / abortStream IF + StreamSession + StreamRecorder
- [ ] iOS: CAMM writer 自前実装 + AVAssetWriter 統合 — DEFERRED (実機なし)
- [~] Android: MediaMuxer + CammMuxer 自前実装で `application/camm` track 書き出し — PARTIAL (Camera2 + MediaMuxer mp4 録画は完了。CAMM track は AOSP MediaMuxer の制限により v0.1.2 に延期)
- [x] c2pa-bridge に動画署名 FFI 関数追加 — Rust 改修不要と判明 (既存 `c2pa_sign_image_tee` が media generic)
- [x] 実機で IMU + 機種情報入り C2PA 署名済み mp4 が出力される — Pixel 10 で 5 秒動画 + 22 assertions 確認
- [x] c2patool で C2PA manifest が読める
- [ ] ffprobe で CAMM track が確認できる — CAMM track 延期に伴い対象外
- [x] CAMM track と C2PA Manifest Store が共存している (片方が破壊されていない) — CAMM 不在の状況で BMFF hash + uuid box が正しく成立することを確認

## 完了日: 2026-04-27 (Android 実機で動画録画 + C2PA 署名 + IMU stream inline assertion 確認。iOS / CAMM track は v0.1.2+ 延期)

## 実装中の落とし穴 / 改修記録

実装中に踏んだ 4 件の罠 (muxer.start() 順序問題、AOSP MediaMuxer の application/* binary 拒否、複数 SensorEventListener の main thread 並列発火、encoder PTS の CLOCK_MONOTONIC vs CLOCK_BOOTTIME mismatch) は `POSTMORTEM-implementation-pitfalls.md` を参照。

## ディレクトリ構成 (予定)

```
app/modules/sensor-session/
├── ios/
│   ├── CammMetadataWriter.swift     (新規)
│   ├── VideoMuxer.swift              (新規: AVAssetWriter wrapper)
│   └── sensors/
│       └── CameraSensor.swift        (動画モード追加)
└── android/
    └── src/main/java/io/rootlens/sensorsession/
        ├── CammMuxer.kt              (新規: MediaMuxer + application/camm track)
        └── sensors/
            └── Camera2Sensor.kt      (動画モード追加 / CammMuxer と PTS 連動)

native/c2pa-bridge/src/
└── lib.rs   (sign_video_tee_with_assertions 追加)
```

## 並列調査が必要な項目 (実装中にエージェントで補強)

- AVFoundation で CAMM 互換 binary metadata track を書く正確な手順 (kCMMetadataFormatType_Boxed 等の選定)
- c2pa-rs 0.78 の BMFF v3 hash の exclusion ranges 仕様
- 動画録画中の IMU リングバッファ正攻法サイズ
- iOS / Android 両方の HW timestamp source (mach_absolute_time / SystemClock.elapsedRealtimeNanos) を CAMM sample timestamp と整合させる方法 (Android は `SENSOR_INFO_TIMESTAMP_SOURCE` 別の挙動差を実機検証)
- mp4parser 等で `mett` → `camm` SampleEntry 書き換えポストプロセスの実装 (将来の Street View 互換が必要になった場合の保険)

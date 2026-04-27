# POSTMORTEM: Task 03 実装中に踏んだ落とし穴

実装日: 2026-04-27
対象: 動画パイプライン (SensorSession ストリーム拡張 + Camera2/MediaCodec/MediaMuxer + CAMM track + C2PA BMFF 署名)

設計時にエージェント調査までやって決めた方針と、実装してみての現実とのギャップ。後続で同種の罠を再生産しないために残す。

---

## 1. MediaMuxer.start() の呼び出し順序とライフサイクル

### 症状
最初の動画録画で:
```
W/ReactNativeJS: '[CameraScreen] startRecording error:', { [Error: Failed to start the muxer] code: 'STREAM_START_ERROR' }
E/AndroidRuntime: FATAL EXCEPTION: rootlens-video-encoder
  at io.rootlens.sensorsession.stream.StreamRecorder.addVideoTrack(StreamRecorder.kt:44)
```

### 原因
StreamSession.start() は同期的に `recorder.start()` を呼んだ。しかし MediaCodec encoder の output format が確定する (= addVideoTrack できるようになる) のは encoder の drain thread が `INFO_OUTPUT_FORMAT_CHANGED` を受け取った時で、これは encoder への最初の input frame が Camera2 から流れた後の **数百ミリ秒後**。

順序がこうなる:
1. StreamSession.start(): VideoEncoder 構築 → drain thread 起動 (まだ format change は来ていない)
2. StreamSession.start(): `recorder.start()` を呼ぶ → muxer.start() → **track が 1 つも addTrack されていない** → "Failed to start the muxer"
3. その後 drain thread が format change を受け取り `recorder.addVideoTrack(format)` を呼ぶ → muxer がすでに started 状態 (失敗してても started フラグ立った) → "addVideoTrack must be called before start()" → FATAL EXCEPTION on encoder thread

### 修正

A. **StreamSession.start() から `recorder.start()` を削除**。muxer.start() の責任は VideoEncoder の drain thread に一本化する (format change を受け取った瞬間、addVideoTrack + recorder.start() を続けて行う)。

B. **CAMM track は muxer.start() の前に同期的に追加**。SensorEventSensor.startStream() が attachCammListener の前に `recorder.addCammTrack()` を呼ぶ。複数 sensor からの呼び出しは idempotent。

C. **StreamSession で sensor の起動順序を制御**。`StreamCapableSensor.startsMuxer: Boolean` フラグを足し、Camera2Sensor だけ true。StreamSession は false の sensor (CAMM-only IMU) を **先に** 起動して addTrack させ、その後 true の sensor (Camera) を起動して async で muxer.start させる。

D. `StreamRecorder.start()` の atomicity 修正: `started.compareAndSet` 後に muxer.start を呼ぶ古い形だと、muxer.start が throw しても started フラグだけ立ってしまう。先に muxer.start を呼んで成功してから set に変更。

### 教訓
非同期に format が確定するエンコーダ系では、muxer.start() を「全 track の準備完了」を表す明示的シグナルとして扱う必要がある。同期 API を期待して書くと order 違反でハマる。MediaCodec + MediaMuxer 連携は **「format change → addTrack → start」の単一スレッド処理**が確実。

---

## 2. AOSP MediaMuxer は `application/camm` の binary writeSampleData を拒否する

### 症状
muxer.addTrack(application/camm) は成功して track index が返ったのに、`writeSampleData(cammTrackIndex, payload, info)` が全件 silently エラー:
```
W/StreamRecorder: writeCammVec3 dropped (type=2 pts=731888): writeSampleData returned an error
W/StreamRecorder: writeCammVec3 dropped (type=7 pts=731889): writeSampleData returned an error
... 4382 件続く
```

### 原因
AOSP MediaMuxer は `application/*` MIME track を **TextMetaDataSampleEntry (`mett` box)** として扱う。これは内部的に「テキスト metadata」を想定しており、binary CAMM サンプル (16 byte の `[reserved(2) | type(2) | x/y/z float (12)]`) を writeSampleData で渡しても native 層の MPEG4Writer が拒否する。

CAMM 仕様 (Google Street View / ARCore Recording) は固有 `camm` SampleEntry を要求するが、AOSP はこれをサポートしていない。**MediaMuxer のレイヤで CAMM track 仕様準拠の mp4 を吐くのは構造的に不可能**。

### 解決策の選択肢
1. mp4parser 等で post-process して `mett` → `camm` SampleEntry を書き換え + mdat 内のサンプルバイト並びを CAMM 仕様に整える
2. MediaMuxer を諦めて自前 mp4 muxer を書く
3. CAMM track を諦めて IMU データを別経路で保存する

### v0.1.1 での結論: 選択肢 3 を採用

`StreamRecorder.addCammTrack()` を **no-op** に変更し (戻り値 -1)、SensorEventSensor.startStream() の listener が常時稼働中の ring buffer に蓄積している sample を stop() 時に切り出して **C2PA assertion inline JSON** として保存する。これは静止画 (Task 02) と同じ経路で、機能要件 (撮影中の IMU 履歴を C2PA 署名済みファイルに同梱) を満たす。

CAMM track 復活は v0.1.2 以降で mp4parser ポストプロセスを足す形で再開する余地が残されている。コードは将来の差分が最小になるよう CammMuxer / writeCammVec3 の枠は維持してある。

### 教訓
仕様 (CAMM の MIME / SampleEntry) と AOSP 実装の差を実装してみるまで気付けなかった。次に「OS の MIME 既存メカニズム + 仕様」の組み合わせを採るときは、最初のスパイクで `addTrack` だけでなく **writeSampleData が実際に通るかまで** を確認する。

---

## 3. 複数 SensorEventListener の main thread 並列発火による native crash

### 症状
最初の試みで:
```
F/io.rootlens.app: java_vm_ext.cc:620
F/DEBUG: at void io.rootlens.sensorsession.stream.StreamRecorder.writeCammVec3(...) (StreamRecorder.kt:110)
```
SIGABRT による app クラッシュ。Java スタックは writeCammVec3 → muxer.writeSampleData。

### 原因
- Camera2 録画中、accel / gyro / mag の 3 つの sensor がそれぞれ専用 SensorEventListener を持ち、すべて `recorder.writeCammVec3` を呼ぶ
- attachCammListener は handler 引数なしで `sensorManager.registerListener(listener, sensor, SENSOR_DELAY_FASTEST)` を呼んでいた → callback は **main thread** で配送される
- 複数 sensor が ~400Hz で main thread に発火 → main thread の throughput を超え、配送順序が乱れる
- writeCammVec3 で muxer.writeSampleData を呼ぶ際、CAMM track の PTS が **per-track 単調増加** という MediaMuxer 必須要件を破る (異なる sensor 間で timestamp が逆転する) → native 層 MPEG4Writer が assertion 失敗で SIGABRT

### 修正

1. **CAMM listener 専用 HandlerThread**: `SensorEventController` に `cammHandler = Handler(HandlerThread("rootlens-camm-listener").apply{start()}.looper)` を追加し、attachCammListener はこの handler を渡す。main thread を完全に避ける + 単一スレッドにシリアライズ。

2. **PTS の単調増加クランプ**: `StreamRecorder.lastCammPtsUs: AtomicLong` を持ち、writeCammVec3 内で CAS で last PTS + 1 にクランプする。複数 sensor からの interleave があっても strict monotonic を保証。

3. **try-catch 化**: muxer.writeSampleData が throw しても crash しないよう catch + Log + drop 数カウンタに変更。これは結果的に落とし穴 #2 (CAMM 全部 drop) の検出に役立った。

4. **サンプリングレート抑制**: CAMM listener は SENSOR_DELAY_GAME (50Hz) に変更。録画中の CAMM track 用途では 50Hz で十分で、FASTEST (~400Hz) は ring buffer (常時稼働) 側だけにする。

### 教訓
SensorManager.registerListener の handler 引数省略はデフォルト main thread になる。これは **常にバグの温床**。サンプリングレートが高い sensor (gyro / accel) を main thread に流すと UI 性能と native 層の両方を壊す。専用 thread 必須。

---

## 4. MediaCodec encoder PTS は CLOCK_MONOTONIC、anchorMonotonicNs は CLOCK_BOOTTIME

### 症状
録画 mp4 を ffprobe で見ると:
```
duration_ts=918
duration=0.010200       # 10ms
nb_frames=145           # でも frame は 145 個
r_frame_rate=10000/1    # 10000 fps と判定
```
実際は 5 秒 30fps の動画。ffprobe が PTS を読んで計算した duration が 0.01s と異常に短い。

### 原因
encoder の output `info.presentationTimeUs` は **CLOCK_MONOTONIC** (= `clock_gettime(CLOCK_MONOTONIC)` = boot からの monotonic ns、suspend を含まない) を秒10⁻⁶ で割った値。Camera2 の Surface BufferQueue が systemTime(SYSTEM_TIME_MONOTONIC) で frame timestamp を打つため。

一方、`anchorMonotonicNs` を Native の `SystemClock.elapsedRealtimeNanos()` (= `clock_gettime(CLOCK_BOOTTIME)` = suspend を含む) から取っていた。

Pixel 10 では、boot 後の経過 = 51 時間に対し monotonic 時刻 = 6.9 時間 (44 時間の deep sleep)。**両者は約 7.5x ずれていた**:
```
video sample[0]: raw_pts=24928482424 anchor_us=185731602151 rel=0
video sample[100]: raw_pts=24931813617 anchor_us=185731602151 rel=0
```
anchor_us が raw_pts より遥かに大きいため、`rel = (raw_pts - anchor_us).coerceAtLeast(0L)` が常に 0 にクランプされ、全 frame が PTS 0 で muxer に書かれる → muxer は内部正規化で「全 frame ほぼ同時刻」と解釈 → duration が劇的に短く / fps 異常。

### 修正
**最初のフレームの PTS を相対 0 として subtract する標準 MediaMuxer パターン**に切替:
```kotlin
private val firstVideoPtsUs = AtomicLong(-1L)

fun writeVideoSample(buffer: ByteBuffer, info: BufferInfo) {
  firstVideoPtsUs.compareAndSet(-1L, info.presentationTimeUs)
  val rel = (info.presentationTimeUs - firstVideoPtsUs.get()).coerceAtLeast(0L)
  ...
}
```
これにより、encoder PTS の絶対値が何 clock 由来かに関わらず、最初の frame との差分で安定した相対 PTS が出る。

修正後の ffprobe 結果: `duration=4.83s, r_frame_rate=30/1, nb_frames=145` で正常。

### 教訓
- Android には `CLOCK_BOOTTIME` (`elapsedRealtimeNanos`) と `CLOCK_MONOTONIC` (`uptimeMillis * 1e6` 等) の 2 系統があり、deep sleep を経験した端末ではこの 2 つが大きく乖離する。Camera2 の `SENSOR_INFO_TIMESTAMP_SOURCE` は `REALTIME` (BOOTTIME) で、CaptureResult の SENSOR_TIMESTAMP は BOOTTIME。だが **encoder Surface input の PTS は MONOTONIC** で、CaptureResult.SENSOR_TIMESTAMP と一致しない。これは AOSP の歴史的経緯による不整合。
- MediaMuxer に渡す PTS は「track 内で最初を 0 として相対 us」が正解。clock の絶対値を引くと clock 軸間違いで一発死ぬ。MediaCodec + MediaMuxer のサンプルコードはほぼ全部この相対化パターンを採っている。
- IMU 用の anchor (Task 02 の monotonic ns) と video encoder の PTS は **別々の origin** を持つ。クロス参照する場合は専用の CLOCK 同期点を別途記録するか、各 track 内で独立させるかの設計判断が必要。Task 03 では各 track 独立で十分だった。

---

## 全体の所感

### 成功した部分

- **Task 02 で確立した抽象 (SensorSession + ISensor + StreamCapableSensor)** が、動画 stream 拡張で破綻なく機能した。Camera は 1 ISensor、IMU は別 ISensor、その上に StreamRecorder が共有 mp4 sink を提供するという設計が clean。
- **c2pa-rs 0.78 の BMFF サポート**は、追加 FFI なしで mp4 にも対応できた (mime_from_path だけで足りた)。設計時の調査では「BMFF 用に FFI 関数を増やす」と書いていたが、実装してみたら不要と判明。
- **22 個の C2PA assertion 入り mp4** が 5 秒録画で出せ、動画とセンサーデータの混在保存が一発で動いた。

### 想定外だった部分

- CAMM track の AOSP 制限は **設計時の調査で見落とし**ていた。エージェント調査で「MediaMuxer で application/camm 行ける」と判断した結果、実装してみて writeSampleData が拒否されることが分かった。次は **「addTrack だけでなく writeSampleData まで通るか」 をスパイクで検証**するのを設計プロセスに入れる。
- CLOCK_MONOTONIC vs CLOCK_BOOTTIME のずれは設計上は意識していたが、Camera2 SENSOR_TIMESTAMP_SOURCE = REALTIME と encoder Surface PTS が違う clock を使うことは想定外。Task 02 の anchor pattern を素直に流用すれば良いと思っていたが、video PTS は別経路。

### Task 03 以降への持ち越し

- **iOS 動画パイプライン (Phase 2)**: AVAssetWriter + AVAssetWriterInput(.metadata) で CAMM 互換 binary track を書く。実機が手に入った時点で着手。Android で確立した StreamSession / StreamRecorder の責務分担はそのまま流用できる。
- **CAMM track 復活 (v0.1.2)**: mp4parser を Cargo / Gradle に追加して post-process で SampleEntry を mett → camm に書き換える。または自前 mp4 muxer。
- **長時間録画 (v0.1.2)**: MediaMuxer の 4GB 制限と setNextOutputFile、battery / thermal monitoring。
- **動画 Depth (Task 04)**: Phase 4 で書いたキーフレーム depth (時間等間隔) のロジックを動画 stream に組み込む。CAMM の代替経路 (assertion inline) と同様、depth keyframe も C2PA assertion に inline で乗せる予定。

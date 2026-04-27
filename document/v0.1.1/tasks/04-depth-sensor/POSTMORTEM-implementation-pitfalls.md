# POSTMORTEM: Task 04 実装中に踏んだ落とし穴と方針変更

実装日: 2026-04-27
対象: Depth センサーを抽象センサー層に追加 (静止画 + 動画両対応)

設計時 (Task 04 README 起草時) は「ARCore Depth API + Camera2 DEPTH16 + iOS AVCaptureDepth + ARKit sceneDepth」を全部入れる前提だったが、実装中に複数の戦略レベルの転換があり、最終的に **「depth は事実上 iOS のみの機能」** に落とし込むことになった。その経緯と判断をまとめる。

---

## 1. ARCore 採用基準の整合化 (Task 03 との一貫性)

### 経緯
Task 04 README には「Android: ARCore `Frame.acquireDepthImage16Bits` (`Config.depthMode = AUTOMATIC`)」「ARCore `Frame.acquireRawDepthImage16Bits`」が記載されていた。一方、Task 03 (動画) では ARCore Recording API を不採用としており、理由は (1) Google Play Services for AR 必須で対応機種が狭まる、(2) battery 重い、(3) ARCore Session が Camera2 を握って自前 CameraSensor と衝突、(4) overkill。

### 認識のずれ
僕が Task 04 着手で「ARCore depth を入れるか」をユーザーに尋ねた段階で、ユーザーから「ARCore 不採用じゃなかったっけ？」と指摘された。Task 03 README では video のみの不採用判断だったが、実質同じ理由 (Play Services 依存、battery、Camera2 衝突) が depth 取得にも当てはまる。

### 最終判断
**ARCore は depth 含め一切採用しない**。Task 03 と Task 04 で方針を完全に揃える。
- Pixel 10 のような ARCore-Only depth 端末では depth 取得不可 = `kind="unavailable"` で graceful に記録
- 物理 ToF / dual-pixel computational を Camera2 公式 API で出す端末が今後の主流になるとの戦略判断 (Pixel 10 が dual-pixel を内部使用しているのが将来開放される可能性、業界トレンド)

### 教訓
複数タスクに跨る方針 (依存採用基準) は **個別タスクの README に書くだけでは不十分**。全タスクで一致させる必要があり、整合性チェックは設計者の責任。Task 03/Task 04 のような並びでは、Task N+1 着手時に Task N の方針を verbatim 流し込むべき。

---

## 2. Pixel 10 の depth 公開 API が事実上閉じている

### 調査結果
Pixel 10 (Google 純正フラッグシップ、2025) は Camera2 の `REQUEST_AVAILABLE_CAPABILITIES_DEPTH_OUTPUT` (= 8) を **公開していない**:

```
[probe] camera id=0 facing=1 caps=[0, 1, 5, 2, 6, 19, 3, 9, 11, 18] depth_capability=false depth_sizes=[]
[probe] camera id=1 facing=0 caps=[0, 1, 5, 2, 6, 19, 3, 11, 18] depth_capability=false depth_sizes=[]
```

`dumpsys media.camera` の生出力には `availableDepthStreamConfigurations: int32[4]` が表示されるが、これは内部 characteristic で公開 API 経由では出ない。Pixel が Portrait Mode 等の自社機能で dual-pixel computational depth を使っているのは事実だが、サードパーティアプリには depth output を渡さない方針。

### Pixel の depth センサー史
- Pixel 4 / 4 XL (2019): フロント Soli レーダー + IR 2 眼で物理 depth (Face Unlock 用)
- Pixel 5 以降 (2020〜): すべて撤去。物理 depth センサーなし
- 現在の Pixel: Computational depth は内部使用のみ、公開 API なし

### 戦略的含意
「Android の主流機種 (Pixel) で depth が取れない」が判明した時点で、抽象設計の正しさだけ検証して先に進む判断が現実的。Camera2Depth16Sensor が `kind="unavailable"` を graceful に記録できることを確認 (assertion 22 個に depth が unavailable で含まれる)。

### 教訓
端末調査は「製品スペック表」と「公開 API での実態」を別物として扱う。Pixel のようにマーケティング上は computational depth を持つ端末でも、公開 API 経由で取得できないなら「取れない」が正しい (Don't be the judge: 我々は OS の API を信じる、内部実装を推測しない)。

---

## 3. exclusivityGroup 意味論の根本的変更

### Task 02 当初の設計
Task 02 README で:
> 同 group 内で複数登録あれば SensorSession が解決する (default: first wins)
> null なら他とフラットに並列

すなわち「同 group の sensor が複数あれば 1 個に絞る」という意味論。これは Camera ↔ ARKit など「同じ HW を排他で取る」ケースを想定していた。

### Task 04 で発覚した不整合
Camera2Sensor (JPEG) と Camera2Depth16Sensor (DEPTH16) は **同じ Camera2 capture session を共有して multi-stream で並列出力できる**。これらは「協調 (cooperative)」関係で、両方走るのが正しい。

しかし当初の意味論だと同 group "android.camera2" 内で 1 個 (= JPEG だけ) しか選択されない → depth が永久に取れない。

### 修正後の意味論
```
- group=null: 常に選択 (他と独立)
- 同じ非 null group: 全員選択 (cooperative — 共有 controller で multi-stream)
- 異なる非 null group: 最初に登録された group のみ採用
```

例:
- "android.camera2" : Camera2Sensor + Camera2Depth16Sensor 両方走る (multi-stream)
- (将来) "android.arcore" : ARCore 系 sensor 群 (Camera2 と排他)。ARCore が先に登録されたら Camera2 系が skip。

### 教訓
abstraction の semantic は **着手前に「同 group が cooperative なのか mutual exclusive なのか」を明示する**。設計図の文章だけだと両方の解釈ができる。実装で噛み砕いて初めてミスマッチが露呈した。

---

## 4. captureBundle パターン (single-trigger / multi-stream)

### 問題
Camera2Sensor.capture() と Camera2Depth16Sensor.capture() は両方 1 ショットで JPEG + DEPTH16 を出す (Camera2 multi-stream)。しかし sensor は独立に capture() を呼ぶので、同じ trigger で 2 回 capturePhoto を発行すると 2 回 撮影が走り、無駄 + 同じ瞬間にならない。

### 解決パターン
`anchorMonotonicNs` を共有 key として、最初の caller が trigger を発行、2 番目以降の caller は cached bundle を待って受け取る。`bundleMutex.withLock { if (cached_for_anchor) return cached else fire_trigger_and_cache }` パターン。

```kotlin
suspend fun captureBundle(anchorKey: Long): CapturedBundle {
  bundleMutex.withLock {
    bundleResult?.let { if (bundleAnchorKey == anchorKey) return it }
    val bundle = doCaptureBundle()  // 1 回だけ実行
    bundleAnchorKey = anchorKey
    bundleResult = bundle
    return bundle
  }
}
```

### 教訓
SensorSession.capture(window) は parallel 実行を前提にしているが、底辺の HW trigger は per-session に 1 回 が望ましい。「sensor 抽象層は parallel」「HW trigger は 1 回 + 結果共有」のレイヤ分離を維持する。captureBundle は今後 ARKit や iOS でも同じパターンで使える。

---

## 5. iOS AVDepthData = AVCapturePhoto に同梱の API パス選択

### iOS の API 構成
iOS の depth 取得には複数経路がある:
- `AVCapturePhoto.depthData` (with `AVCapturePhotoSettings.isDepthDataDeliveryEnabled = true`)
- `AVCaptureDepthDataOutput` (streaming depth)
- ARKit `ARFrame.sceneDepth` (LiDAR only, ARSession 必須)
- ARKit `ARFrame.smoothedSceneDepth` (LiDAR + 時間平滑)

### 選択
v0.1.1 では **AvCaptureDepthDataSensor のみ実装** (`AVCapturePhoto.depthData` 経路)。理由:
- 静止画 capture と一発で取れる (CameraSensor と captureBundle で共有可)
- LiDAR (`builtInLiDARDepthCamera`, iOS 15.4+) / TrueDepth / Dual Cam すべて同 API
- ARKit を使わないため AVCapture session ライフサイクルと衝突しない

ARKit sensors (`ArkitSceneDepthSensor`, `ArkitSmoothedSceneDepthSensor`) は **v0.1.2 以降に延期**:
- ARSession と AVCaptureSession は同一 camera を排他取得 → cooperative 不可
- exclusivityGroup を `"ios.arkit"` (≠ `"ios.av_session"`) で登録すると現意味論では skip される
- LiDAR-only モードを UI で明示的に選ぶ仕組みが必要 (`SensorSession` の active group 切替 API)

### 教訓
iOS 側の depth API はすでに統合的 (AVCapturePhoto に depth が同梱) なので、Android よりも実装がシンプル。ARKit を持ち込まない範囲では AVCapture path 1 本で LiDAR / TrueDepth / Dual すべてカバーできる。これは iOS の素直な強み。

---

## 6. PNG16 ロスレス変換の延期判断

### 当初計画
DEPTH16 raw bytes (16-bit unsigned mm 単位) を PNG16 に圧縮して assertion `data` フィールドに base64 inline 同梱する。raw 約 154KB / PNG16 圧縮で 30〜60% 縮小予想。

### 実態
Pixel 10 で depth が取れない以上、PNG16 encoding パスは検証不能。実装しても「実機で動くかどうか」が判断できない。

### 判断
v0.1.1 では **raw bytes を base64 でそのまま inline** する (圧縮なし)。iOS 側も同様 (`AvCaptureDepthDataSensor.payload.raw_base64`)。
- pros: シンプル、確実、検証可
- cons: assertion size 増 (154 KB / 30fps depth なら × frame 数)
- v0.1.2: 物理 ToF Android 端末を入手するか iOS 実機で動作確認した上で PNG16 / EXR / 圧縮 float 等を比較する

### 教訓
encoding 最適化は **動作する実機で計測してから決める**。raw → 圧縮の必要性は size と CPU 負荷の trade-off で、実測なしに決めるのは早い。

---

## 7. 動画 depth キーフレーム抽出の延期判断

### 当初計画
動画録画中に 1 秒間隔で depth キーフレームを抽出し、C2PA assertion に `frame_pts_ns` 付きで埋める (`io.rootlens.capture.android.camera2.depth16.builtin_back_default__1` 等)。

### 実態
Task 03 の Android 動画 mode は CameraSessionController.rebuildSession で **video モードでは depth output を session から外している** (理由: encoder 占有 + CAMM track / depth multi-stream の組合せが機種依存で危険)。すなわち動画モード中は depth が出ない。

iOS 側は AVAssetWriter による動画録画自体が Phase 4 of Task 03 で延期されているため、動画 depth も連動して延期。

### 判断
v0.1.1 動画 + depth はサポートしない。
- 静止画: depth 同梱 (Pixel 10 では unavailable / iOS 対応機では取得)
- 動画: depth なし (Camera + IMU のみ)

v0.1.2 で iOS 動画録画 + AVCaptureDepthDataOutput streaming + キーフレーム抽出を一気に組む方針。

### 教訓
タスク間の依存 (Task 03 video pipeline → Task 04 video depth) は片方が deferred になると連鎖して deferred になる。スコープ判断はバルクで行うべき。

---

## 8. 全体総括 — 「depth は iOS 専用」が現実的解

### 最終的なポジション
- **Android**: 公開 API で depth が取れる端末がほぼ存在しない (Pixel は意図的に閉じ、Samsung/LG の ToF 機種も新機種で減少傾向、Sony 等の限定的な機種のみ)。RootLens の Camera2Depth16Sensor は対応機種が出れば自動で動く設計だが、近い将来は実質 unavailable 一択
- **iOS**: LiDAR (Pro 系)、TrueDepth (フロント全機種)、Dual/Triple カメラ disparity (無印 7 Plus 以降) で depth が取れる。AVCaptureDepthDataOutput 経由で 1 本化されている
- **戦略**: depth feature は iOS で売り、Android は graceful unavailable で透明に扱う

### 抽象設計の妥当性
v0.1.1 で組んだ抽象 (NativeSensor + exclusivityGroup cooperative + captureBundle) は、現状の Pixel 10 で graceful に振る舞い、将来の depth-capable Android が登場しても自動で depth assertion を出せる構造を維持している。

「Don't be the judge」原則のおかげで、「Android = depth ない」「iOS = depth ある」を抽象側がハードコードする必要がない。OS が capability を返せば取る、返さなければ unavailable で記録、という単純なルールに尽きる。

### Task 04 で得たもの
- exclusivityGroup の cooperative 意味論 (将来 Task 05/06 で必要)
- captureBundle パターン (今後の sensor 拡張で再利用可)
- iOS AVCaptureDepth コード骨格 (実機テスト時にすぐ動かせる状態)
- 「Pixel 10 では depth が取れない」という戦略的事実

### v0.1.2 への持ち越し
1. ARKit sceneDepth / smoothedSceneDepth 実装 + LiDAR-only mode UI 切替
2. PNG16 / EXR / 圧縮 encoding (実機計測後に選定)
3. 動画 depth keyframe extraction (iOS 動画録画と一緒に)
4. depth-capable Android 端末での実機検証 (Galaxy S20 Ultra / Sony Xperia 1 等)

# Task 05: Title Protocol register (Android port)

## 目的

Sandbox 04 で撮影したクリップを Title Protocol に登録し、Solana devnet 上で Core NFT として発行するまでのフローを Android で動かす。iOS 側 ([04 collection-flow](../04-collection-flow/) + 後追い実装) ではすでに Result → Mint Core NFT → Solscan link まで通っている。Android はまだ録画ネイティブがそもそも実装されていないので、そこから揃える。

## 背景

### iOS で先行して動いた構成

- 録画 / snapshot は `HandPoseCameraController.shared` (singleton) が AVCaptureSession を own。`HandPoseModule` の AsyncFunction (`captureSnapshot` / `startRecording` / `stopRecording`) が controller を呼ぶ。
- Result 画面に `Mint Core NFT →` CTA を載せ、押下で MintView へ遷移。MintView は scroll なし 1 ページで:
  - Core NFT の説明 3 bullet (license issuance right / copyright stays / Title Protocol verified)
  - `I agree — mint Core NFT` CTA
  - Mint 中はプログレス、成功で contentHash / tx / Solscan link
- TP register 本体は `app/src/services/titleProtocol.ts`。ECDH+HKDF を JS (@noble/curves)、AES-256-GCM をネイティブ (CryptoKit / javax.crypto) で行うので 5 MB 級コンテンツが JS↔Native bridge を通過しない。
- AES-GCM は `NativeModules.AesGcmBridge` 経由 (RN bridge)。

### Android の現状

| パーツ | 状態 |
|---|---|
| `AesGcmModule.kt` (RN bridge `AesGcmBridge`) | ✅ 実装済 + `MainApplication` で package 登録済 |
| `nativeCryptoProvider.ts` / `titleProtocol.ts` / `MintView.tsx` | ✅ プラットフォーム非依存。Android でもそのまま動く想定 |
| `HandPoseModule.kt` の `captureSnapshot` / `startRecording` / `stopRecording` | ❌ 未実装 (View のみ提供。録画も snapshot も無い) |
| `HandPosePreviewView.kt` | CameraX Preview + ImageAnalysis のみ。recording use case 未 bind |
| `camera-video` deps | ❌ build.gradle 未追加 |

つまり Android は AES-GCM と TP register JS は揃っているのに、**録画 mp4 ファイルが手に入らない**ので CTA を押せない (canMint=false) 状態。

### なぜ singleton 化するか

iOS と同じ理由。view は React の reconciler 都合で何度でも mount/unmount される。recording 中に view が unmount されたら録画が止まる、というのは UX 的に NG。controller を view から独立させ、view は frame consumer を attach するだけにする。これで Module 関数からも camera state にアクセスできる。

## 実装方針

### Phase 1: HandPoseCameraController (Android, singleton)

`app/modules/hand-pose/android/src/main/java/io/rootlens/handpose/HandPoseCameraController.kt` を新規作成。

責務:
- `ProcessCameraProvider` を own。Preview / ImageAnalysis / VideoCapture の 3 use case を bind
- 直近 ImageAnalysis frame の Bitmap を cache (snapshot 用)
- VideoCapture の Recording を start/stop (recording 用)
- HandPosePreviewView から `attachPreviewSurface(SurfaceProvider)` で preview を受け取る

API:
```kotlin
object HandPoseCameraController {
  fun bind(lifecycleOwner: LifecycleOwner, context: Context)
  fun unbind()
  fun setPreviewSurfaceProvider(provider: Preview.SurfaceProvider?)
  fun setFrameConsumer(consumer: ((Bitmap, Int) -> Unit)?)  // (bitmap, rotation)
  suspend fun captureSnapshot(): String   // file:// URI
  fun startRecording(outputPath: String): String  // file:// URI
  suspend fun stopRecording(): String  // file:// URI (after finalize)
}
```

設計メモ:
- `bindToLifecycle(lifecycle, BACK_CAMERA, preview, analysis, videoCapture)` で 3 use case まとめて bind。Pixel 10 / 大半の Android で問題なく通る (CameraX 1.4+)
- video の audio は無効。`Recorder.Builder().setQualitySelector(...).build()` のみで `VideoCapture.withOutput(recorder)`、recording 時は `prepareRecording(...).start(executor) { event -> ... }` (audio mute は MediaPipe 系と同様 microphone permission 不要のため)
- 直近 frame の Bitmap は `setFrameConsumer` で view から流してもらう。controller は最後の rotated bitmap を `latestSnapshotBitmap` に持つ
- snapshot 保存先は `context.cacheDir/rootlens_snapshot_<ts>.jpg`

### Phase 2: HandPosePreviewView refactor

現状の view 内部 `bindCamera()` を削除し、`HandPoseCameraController` に委譲:
- `onAttachedToWindow`: controller.bind(this, ctx); controller.setPreviewSurfaceProvider(previewView.surfaceProvider); controller.setFrameConsumer(...)
- `onDetachedFromWindow`: controller.setPreviewSurfaceProvider(null); controller.setFrameConsumer(null); controller.unbind()
- 既存の `onFrame(image)` → `setFrameConsumer { bitmap, rotation -> detect & emit onHandPose }` に転置
- detect 結果の emit (`onHandPose`) は view 側で継続 (controller は detect を持たない)

### Phase 3: HandPoseModule の AsyncFunction 追加

`HandPoseModule.kt` に 3 個追加:
```kotlin
AsyncFunction("captureSnapshot") { promise: Promise ->
  HandPoseCameraController.captureSnapshot(...)
}
AsyncFunction("startRecording") { outputPath: String, promise: Promise ->
  val url = HandPoseCameraController.startRecording(outputPath)
  promise.resolve(url)
}
AsyncFunction("stopRecording") { promise: Promise ->
  HandPoseCameraController.stopRecording(...)
}
```

### Phase 4: build.gradle 修正

`app/modules/hand-pose/android/build.gradle` に:
```gradle
implementation "androidx.camera:camera-video:$camerax_version"
```

(camerax_version は app の root に既に定義済 → 同じバージョンを使う)

### Phase 5: TP register の動作確認

JS 側の `nativeCryptoProvider.ts` / `titleProtocol.ts` / `MintView.tsx` は無変更で動くはず。確認ポイント:
- `NativeModules.AesGcmBridge` が Android で `AesGcmModule.kt` を解決する (`getName() = "AesGcmBridge"`、`MainApplication.getPackages()` に `AesGcmPackage()` 登録済)
- `expo-file-system` の `cacheDirectory` が Android では `/data/user/0/io.rootlens.app/cache/` になる。`uploadAsync` で `file://` prefix 付き URI を渡せば動く
- video が CameraX で 1080p mp4 出る → TP の `verify` は VPDQ (video perceptual hash) で content hash 計算

### 検証手順 (Pixel 10)

1. `npx expo run:android`
2. sandbox 04 → fold-laundry 等任意のタスク → 両手パー 1 秒 → カウントダウン → 録画 → 両手サムズアップ 1 秒
3. Result 画面の右下に `Mint Core NFT →` (canMint=true)
4. 押すと MintView。`I agree — mint Core NFT` を押下
5. logcat で `[TP] fetchGlobalConfig done` → ... → `[TP] sign-and-mint done` のシーケンスが流れる
6. 完了で MintedView が出て contentHash / txSignature 表示。`Open in Solscan ↗` で devnet explorer が開く

## 完了条件

- [ ] `HandPoseCameraController` (singleton, Kotlin) で Preview + Analysis + Video の 3 use case が同時 bind できる
- [ ] `captureHandPoseSnapshot()` が Android で JPEG 出力 (rotation 適用済) を返す
- [ ] `startHandPoseRecording()` → `stopHandPoseRecording()` で再生可能な mp4 が出る (1080p 30fps、無音)
- [ ] sandbox 04 が iOS と同じ UX で Android でも回る
- [ ] Result → MintView → TP register が成功し、Solana devnet で cNFT が mint される (`tx_signatures[0]` が返る)
- [ ] MintView の Solscan link が開く

## 制限事項 (sandbox 段階)

- 録画 audio は無効。物理 AI 訓練データ用なので音声不要 (microphone permission も要らない)
- `VideoCapture` を bind した状態で ImageAnalysis を回す構成は CameraX 1.4 以降の `Concurrent3StreamLimit` 挙動に依存。一部低 RAM デバイスで stream config failure が出る場合は QualitySelector を 720p に下げる
- ultra-wide / wide 切替は本タスクのスコープ外 (rootlens-mobile で実装した `setPhysicalCameraId(3)` 周りは v0.1.2 統合フェーズの sensor-session 側で扱う)
- TP node が "No healthy TEE node found" を返す場合は TP gateway 側 (devnet) の問題。クライアントの責務外
- C2PA 署名は本タスクではスコープ外。unsigned mp4 を TP に投げる前提 (TP 側は perceptual hash + 任意の signed_json で動く)

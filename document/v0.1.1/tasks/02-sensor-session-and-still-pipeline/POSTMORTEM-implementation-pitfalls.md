# POSTMORTEM: Task 02 実装中に踏んだ落とし穴

実装日: 2026-04-26 〜 2026-04-27
対象: Plan C 撮影スタック + 抽象センサー層 + 静止画パイプライン

設計時には見えなかったが、実装してビルドして実機で動かす段階で噴出した問題と、それぞれの恒久対処をまとめる。後続タスク (Task 03 動画 / Task 04 Depth / Task 05 ライブ UX) で同種の罠を再生産しないために残す。

---

## 1. Expo Module の Gradle `singleVariant` 重複

### 症状
`./gradlew assembleDebug` 一発目:
```
Using singleVariant publishing DSL multiple times to publish variant "release" to component "release" is not allowed.
A problem occurred evaluating project ':sensor-session'.
```

### 原因
新規 Expo Module の `android/build.gradle` に scaffold として書いた:
```groovy
publishing {
  singleVariant("release") { withSourcesJar() }
}
```
これは Expo Modules Core の `useExpoPublishing()` 内で **既に同じことを呼んでいる**。重複登録で Gradle が拒否。

### 修正
`build.gradle` から `publishing { singleVariant("release") { ... } }` ブロックを丸ごと削除。`useExpoPublishing()` 経由の自動構成に任せる。

### 教訓
新規 Expo Module の build.gradle は **Expo の helper (`useExpoPublishing`, `useCoreDependencies`) 以外を書かない**。雛形をネット記事から拾ってくると古い情報が混じる。`expo-modules-core/android/ExpoModulesCorePlugin.gradle` を読んでから書くのが確実。

---

## 2. Kotlin `Module` 親クラスのメンバー上書き (`registry` 名衝突)

### 症状
```
e: SensorSessionModule.kt:25:3 Cannot weaken access privilege 'public' for 'registry' in 'Module'
e: SensorSessionModule.kt:25:15 'registry' hides member of supertype 'Module' and needs 'override' modifier
```

### 原因
`expo.modules.kotlin.modules.Module` は内部で `registry` プロパティを公開している。我々の SensorSessionModule で `private val registry = SensorRegistry()` と書くと親メンバーを accidentally override してアクセス修飾子も落ちる。

### 修正
フィールド名を `sensorRegistry` にリネーム。

### 教訓
Expo Module 派生クラスでは **`registry` / `appContext` / `definition` 等の親既存名は避ける**。フィールド命名は `sensor*` のように namespace を切るのが安全。

---

## 3. Expo Modules View Manager 名 = Module 名 (View クラス名ではない)

### 症状
JS で `requireNativeViewManager('SensorPreviewView')` した瞬間に warning:
```
The native view manager required by name (SensorPreviewView) ... isn't exported by expo-modules-core.
Exported view managers: [SensorSession, ExpoCamera, ExpoVideoView].
```

### 原因
Expo Modules では **1 Module = 1 View** が基本で、View Manager 名は Module 名 (`Name("SensorSession")` で宣言したもの) に固定される。`View(SensorPreviewView::class)` のクラス名は内部用で、JS から見える名前は Module 名。

### 修正
TS 側 wrapper の `requireNativeViewManager('SensorSession')` に変更。コメントで規約を明記。

### 教訓
Expo Module で複数 View を出したい場合は別 Module を立てる必要がある (確認したら設計判断する。Task 05 でカメラとプレビューの分離を再考するときの観点)。

---

## 4. AVCaptureSession / Camera2 セッション競合 (= Plan A 否定)

### 症状
最初の Phase 5 設計時、僕が「expo-camera を残してプレビューだけ流用、撮影は SensorSession 経由」案 (A1) を出した。Task 03/04/05 を読み返したら整合性が崩れることに気付いた。

### 原因
- iOS: 同一 AVCaptureDevice に対して `AVCaptureDeviceInput` を 2 つの `AVCaptureSession` から attach 不可
- Android: 同一 `cameraId` を 2 つの `CameraDevice.openCamera` で同時 open 不可
- Task 04 が「ARSession と AVCaptureSession を `exclusivityGroup` で排他制御」する前提で Plan C session の **singleton** を要求
- Task 05 のライブプレビューも「**SensorSession の Camera ISensor が握る session を Preview View に attach**」と明記

つまり expo-camera と Plan C session を併存させた瞬間、その瞬間から Task 03/04/05 の前提が壊れる。

### 修正
A1 案を破棄、A2 (Task 02 で最低限ネイティブ Preview View) を採用。expo-camera の `CameraView` は撮影フローから完全撤去 (package.json からの削除は Task 05)。

### 教訓
新タスクの設計判断を出す前に **後続タスクの README を全部読んで整合性確認**する。1 タスクの README しか読まずに案を出すと、3 タスク先で破綻する設計を採ってしまう。今回 1 度ユーザーに止められた (「PlanCと競合しない？タスクファイル1〜6まで全部読んでその判断をしたということですか？」) のはまさにこの理由。

---

## 5. Camera2 session 構築のデッドロック

### 症状
APK インストール → カメラ画面開いてもプレビュー真っ黒、シャッター押しても「証明付与中」で止まる、エラーログは一切なし。

### 原因
`CameraSessionController.setPreviewSurface()` の旧実装:
```kotlin
backgroundHandler.post {
  kotlinx.coroutines.runBlocking { rebuildSessionIfReady() }
}
```
- `backgroundHandler` は `HandlerThread("rootlens-camera")` で駆動される単一スレッド
- そのスレッド上で `runBlocking { rebuildSessionIfReady() }` を実行 → スレッドが suspend 待ちで block
- `rebuildSessionIfReady()` 内で `cameraManager.openCamera(id, callback, backgroundHandler)` 呼出
- `openCamera` の `onOpened` callback は引数 `backgroundHandler` 経由で配送される
- callback を受け取るべき backgroundHandler のスレッドは **同じ block で待機中**
- → **永久にデッドロック**。エラーも throw されないので silent hang

### 修正
セッション構築用に独立した CoroutineScope を持たせる:
```kotlin
private val ctlScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
private val configMutex = Mutex()

fun setPreviewSurface(s: Surface?) {
  synchronized(lock) { previewSurface = s }
  ctlScope.launch { configMutex.withLock { rebuildSessionIfReady() } }
}
```
- `ctlScope` は `Dispatchers.IO` で別スレッドプール
- `configMutex` で複数経路 (PreviewView attach / capture call) からの configure 競合を直列化
- `backgroundHandler` は Camera2 callback の配送専用に保つ → suspend 待ちでブロックされない

### 教訓
**Camera2 callback 配送スレッド ≠ session 構築 suspend を駆動するスレッド** にする。HandlerThread を session 構築でブロックしてはいけない。`runBlocking` を Looper-backed thread の中で使うのは ほぼ常に間違い。

---

## 6. JS wall-clock ns vs Native monotonic ns の時間軸不整合 (anchor pattern 導入)

### 症状
1 度ビルドが成功し、撮影 → 署名 → 21 個の assertion 入り JPEG が出力できた。しかし検証エージェントに走らせたら **13 個の IMU assertion 全部 sample_count = 0**。リングバッファに sample は溜まっていたのに切り出しで 0 件。

### 原因
1. JS-side `captureFlow.ts` の `makeStaticPhotoWindow()`:
   ```ts
   const startNs = BigInt(Date.now()) * 1_000_000n;  // wall-clock epoch ns ≒ 1.78e18
   ```
2. Native ring buffer は `SensorEvent.timestamp` (= `SystemClock.elapsedRealtimeNanos()` 軸) を保存。Pixel 10 の `elapsedRealtimeNanos` ≒ 1.76e11 (boot から ~48 時間)
3. `SensorEventSensor.windowRangeNs(window)` で `[window.startNs - lookbackNs, window.startNs + durationNs]` 範囲で filter
4. window.startNs (1.78e18) と sensor timestamp (1.76e11) は **10,000,000 倍以上ずれている**
5. 結果として ring buffer の全 sample が範囲外 → samples=[]

カメラ assertion だけ正しい値が入っていたのは、Camera2Sensor が `SystemClock.elapsedRealtimeNanos()` で自前 timestamp を打っていたため、IMU リングバッファとの整合は問題なかった。

### 修正
**Anchor monotonic ns** パターンを導入。`SensorTimeWindow` に `anchorMonotonicNs` フィールドを追加し、ネイティブ層 capture 入口で `SystemClock.elapsedRealtimeNanos()` (Android) / `mach_absolute_time` (iOS) を記録。IMU slice はこの anchor を基準にする。

- `JS-side window.startNs` は **wall-clock 時刻** として保持 (assertion に同梱、人間可読の文脈)
- `anchorMonotonicNs` は **slice の基準** (sensor timestamp と同軸)
- 両者を同居させて役割を分離

修正後、`type_accelerometer = 401 samples`, `type_gravity = 201 samples` 等が正しく入った。物理値も妥当 (重力 |g|=9.810 m/s²)。

### 教訓
**JS から渡る時刻パラメータは wall-clock 系** (Date.now ベース) **しかありえない**。ネイティブセンサーの timestamp は **必ず monotonic 系**。両者を混ぜるな。捕捉の時刻軸を「ネイティブ層の入口で確定」する設計を、抽象センサー層 IF レベルで強制する。Task 03 の動画 IMU stream / CAMM track 同期でも同じ罠が待っているので、anchor 概念をそのまま流用する。

---

## 7. JS → Legacy ReactBridge 経由の JSON 変換: 統一 `out.put(when{})` パターンが Number を化けさせる

### 症状
IMU sample の生データ問題を追っていた最中、最初の修正案 (Kotlin 側で `out.put(when (type) { ... value.getDouble(i) ... })`) を入れたら依然として `"values": ""`。

### 原因
仮説: Kotlin `when` 式の型は `Any` (各 branch が Boolean/Double/String/JSONObject/JSONArray を返すため)。`out.put(any: Any)` のオーバーロード解決で `JSONArray.put(Object)` が静的に選ばれる。Double を Object overload で put すると、特定環境で `JSONArray.toString()` が "" を返すケースが観測される (再現条件は完全には特定できず、最終的に CBOR 由来でないことが判明)。

### 修正
`put(when{})` を per-type に明示分解:
```kotlin
when (value.getType(i)) {
  ReadableType.Null -> out.put(JSONObject.NULL)
  ReadableType.Boolean -> out.put(value.getBoolean(i))
  ReadableType.Number -> out.put(value.getDouble(i))   // primitive double overload
  ReadableType.String -> out.put(value.getString(i))
  ReadableType.Map -> out.put(readableToJson(value.getMap(i)))
  ReadableType.Array -> out.put(readableToJson(value.getArray(i)))
}
```
`put(double)` プリミティブオーバーロードに **コンパイル時に静的解決** されることを保証する。

### 結果
最終的にこの問題自体は CBOR/c2patool 側 (落とし穴 8) だったが、**JSONArray.put / JSONObject.put は per-type 明示呼び出しの方が予測可能**であることは確認できた。コードはこの形で残す。

### 教訓
Kotlin `when` 式の return-type promotion で Object overload に解決される箇所は要注意。JSON 系 builder は **明示的な per-type 呼び出し**にしておく方が安全。

---

## 8. c2patool が nested float array を `"values": ""` で表示する (= 表示バグ、データは健全)

### 症状
sample_count=0 を解消した後、c2patool で再検証 → `samples[i].values` がすべて空文字列に化ける。
```json
{ "accuracy": 1, "t_ns": "...", "values": "" }
```

### 原因究明 (raw CBOR を直 decode)

1. JPEG の APP11 segment を抽出 → JUMBF の生バイト 239 KB
2. `type_accelerometer` を含む assertion box を抜き出す
3. Python `cbor2` で decode:
   ```
   decoded: [0.1471685916185379, 6.689698696136475, 6.68910026550293]
   ```
4. CBOR バイナリレベルで:
   ```
   "values" (text key)
   0x83  (CBOR array, length 3)
   0xfb 0x3fc2d66ba0000000  (float64 ≒ 0.1472)
   0xfb 0x401ac24060000000  (float64 ≒ 6.6897)
   0xfb 0x401ac1a380000000  (float64 ≒ 6.6891)
   ```
   **物理的に妥当な加速度値 (重力 9.81 m/s² 含む手持ち撮影の x/y/z 成分)** が完全に格納されている。

つまり:
- Kotlin → JS → Native bridge → Rust → c2pa-rs → CBOR 全段で **データは正しく保存される**
- **c2patool が CBOR を JSON に再変換するときに nested float array → `""` の変換ミス**

### 修正
**修正不要**。我々の実装は正しい。c2patool の表示バグ。後続タスクの公開ページ (Task 06) は **CBOR を独自に decode** する方針なので影響なし。

### 教訓
- c2patool の JSON 出力は **検証用ツールとしてはそのまま信用しない**。重要な値は CBOR を直 decode する。
- 検証エージェント / ユーザー報告で「データが消えてる」と言われても、CBOR レベルで確認するまで実装側のバグと決めつけない。
- v0.1.1 の検証ストーリー (Task 06 公開ページ) は **CBOR 直 decode** で構築する設計を予定通り堅持する。

### CBOR 直 decode で確認した最終データ品質 (Pixel 10 静置気味手持ち撮影)

| センサー | サンプル数 | 合成 \|v\| | 物理判定 |
|---|---|---|---|
| `type_accelerometer` (raw) | 401 | 9.524 m/s² | 重力含む ✓ |
| `type_gravity` (fused, 重力のみ) | 201 | **9.810 m/s²** | 教科書通り ✓ |
| `type_gyroscope` | 401 | 0.502 rad/s | 手の微小回転 ✓ |
| `type_magnetic_field` | 100 | 18.5 μT | 室内・電子機器近辺 ✓ |
| `type_linear_acceleration` (重力除去) | 66 | 0.79 m/s² | 手の動きのみ ✓ |

→ 「Don't be the judge / API レスポンスをそのまま記録」が完全に動作。

---

## 全体の所感

### 「妥協なし Plan C」を選んだことで増えた作業

- expo-camera の中身 (権限ハンドリング以外) を全て自前再実装
- AVCaptureSession / Camera2 のライフサイクル管理を直接書く必要が出る (落とし穴 5 のデッドロックはここから)
- View Manager / Module の Expo 規約をまともに踏みにいく (落とし穴 1〜3)

これらは想定済みのコスト。代わりに得たもの:
- exclusivityGroup で AVCaptureSession 系 / ARSession 系の競合を 1 か所で解決できる構造
- IMU/Camera を対等に並べた抽象 (Camera が 1 ISensor にすぎない)
- 動画 (Task 03) / Depth (Task 04) を「同じパイプラインに ISensor を足すだけ」で乗せられる素地

### 「Don't be the judge」が抽象設計の北極星として機能した

API path 名をそのまま id / assertion label に使い、OS の返すレスポンスを判定なしに格納する設計が、 21 個の assertion 全部に貫徹された。c2patool で 21 ラベルが見えた瞬間、CBOR で 1300 サンプルが復元できた瞬間、思想が実装に正しく落ちていることが確認できた。

### Task 03 以降への持ち越し

- **anchor pattern** は動画 (Task 03) で必須再利用 (CAMM track の sample timestamp ↔ window 整合)
- **session 排他 (exclusivityGroup)** は Task 04 (ARKit / ARCore Depth が AVCaptureSession / Camera2 を握る) で本格運用
- **c2patool の表示バグ** は Task 06 (公開ページ) で CBOR 直 decode 経路を組むことで回避済みの設計
- **expo-camera の package.json 削除** は Task 05 で実施 (現状は import なし、依存パッケージのみ残存)

### 残っている未確認項目

- iOS 実機テスト (実機なし。コードは整合性のため iOS にも anchor / View / Module 修正を入れているが、ビルド・動作は未検証)
- Adobe Verify (contentcredentials.org) でのベース C2PA 署名検証 (signed_test4.jpg をオンライン検証ツールにアップすれば確認可)
- ライブプレビューのアスペクト比調整 (Task 05 で本実装)

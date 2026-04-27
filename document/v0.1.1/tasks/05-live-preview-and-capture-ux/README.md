# Task 05: ライブプレビュー UI + 撮影画面 UX (EditScreen 撤去 + カメラロール選択)

## 目的

Plan C 採用の代償として、撮影中のライブプレビューおよび撮影 UX をすべて自前で実装する。
あわせて v0.1.1 のフロー簡素化として **EditScreen を撤去**し、撮影 / カメラロール選択から直接 Registration へ遷移する設計に切り替える。

達成事項:

1. **撮影中ライブプレビュー描画** — iOS `AVCaptureVideoPreviewLayer` / Android `SurfaceView` (or `TextureView`) を Expo Modules API で RN に露出
2. **撮影 UX 復元** — ズーム / フォーカス / orientation / フラッシュ / カメラ切替 (front/back) / 静止画⇄動画モード切替 / シャッター UI
3. **EditScreen の撤去** — 編集機能 (クロップ / マスク / トリミング) は v0.1.1 から削除。撮影 / カメラロール → 即 Registration
4. **カメラロール選択フロー** — `expo-image-picker` 等で既存メディア選択 → C2PA 署名なしで Registration へ (sensor 取得は撮影時のみ)

### 思想

撮影 UX とアーキテクチャ思想は分離する。
撮影 UX は「ユーザー目線で自然に撮影できる」ことが目的で、内部の SensorSession 抽象とは独立に作る。
ただし UI が SensorSession に投げる契約は **シャッターボタン押下 = `SensorSession.capture(window)`** の単純呼出に統一する。

## 仕様書参照

- v0.1.0 §3 撮影フロー (現状仕様。EditScreen の言及があれば差分を v0.1.1 仕様書ドラフトに反映)
- Task 02 の SensorSession 契約

## 技術スタック

```
[CameraScreen.tsx (RN UI)]
  ├── PreviewView          (ネイティブビュー: AVCaptureVideoPreviewLayer / SurfaceView)
  ├── ShutterButton        (静止画: 単発 capture / 動画: 押下開始-離脱終了)
  ├── ModeSwitch           (静止画 / 動画)
  ├── FacingSwitch         (back / front)
  ├── FlashControl         (auto / on / off)
  ├── ZoomGesture          (pinch / slider)
  └── FocusTap             (tap-to-focus)
        │
        ▼
[SensorSession (Task 02)]
  capture({ startMs, durationMs })
        │
        ▼
[Registration へ画面遷移]
  signedUri を渡して即 Registration (EditScreen を経由しない)
```

## 実装内容

### Phase 1: ネイティブプレビュー View 露出 — PENDING

**iOS** (`app/modules/sensor-session/ios/PreviewView.swift`):
- `Expo Modules API` の `View` 拡張として実装
- 内部に `AVCaptureVideoPreviewLayer` を保持
- `SensorSession` の Camera ISensor が握る `AVCaptureSession` をプレビュー View に attach
- View が dispose される時に session detach

**Android** (`app/modules/sensor-session/android/src/main/java/io/rootlens/sensorsession/PreviewView.kt`):
- `SurfaceView` または `TextureView` ベース
- `Camera2Sensor` が握る `CameraDevice` の output Surface にプレビュー Surface を追加
- View dispose 時に Surface 切り離し

RN 側からは `<SensorPreviewView style={...} />` のような React Component として使える状態にする。

### Phase 2: 撮影 UX (ズーム / フォーカス / orientation / フラッシュ) — PENDING

**ズーム**:
- iOS: `AVCaptureDevice.videoZoomFactor` を pinch / slider で変更
- Android: `CaptureRequest.SCALER_CROP_REGION` または Camera2 の `setZoomRatio` (API 30+)

**フォーカス**:
- iOS: tap 座標を `AVCaptureDevice.focusPointOfInterest` に変換、`focusMode = .autoFocus`
- Android: tap 座標を `CONTROL_AF_REGIONS` に変換

**Orientation**:
- 端末回転検出 (DeviceOrientation) → AVCaptureConnection.videoOrientation / Camera2 JPEG_ORIENTATION 設定

**フラッシュ**:
- iOS: `AVCapturePhotoSettings.flashMode` (auto / on / off)
- Android: `CONTROL_AE_MODE_ON_AUTO_FLASH` 等

**カメラ切替**:
- 内部の Camera ISensor を再選択 (`AVCaptureDevice.default(.builtInWideAngleCamera, position: .front)` 等)

これらは全部 Camera ISensor のプロパティとして TS 側から設定可能にする。

### Phase 3: シャッター UI とモード切替 — PENDING

- 静止画モード: タップで `SensorSession.capture({ startMs: now, durationMs: 0 })`
- 動画モード: 押下時に capture 開始、離脱時に終了 (`durationMs` は実測値で確定)
- モード切替トグル: 静止画 / 動画。動画モードでは MediaMuxer + CammMuxer (Android) / AVAssetWriter + CammMetadataWriter (iOS) を準備 (実装は Task 03)

### Phase 4: EditScreen 撤去 — PENDING

現状のフロー (v0.1.0):
```
CameraScreen → 撮影 → EditScreen (クロップ/マスク/トリミング) → RegistrationScreen → Publishing → 公開
```

新フロー (v0.1.1):
```
CameraScreen → 撮影 → RegistrationScreen → Publishing → 公開
GalleryScreen → カメラロール選択 → RegistrationScreen → Publishing → 公開
```

撤去内容:
- `app/src/screens/EditScreen.tsx` を削除
- `signContentWithParent` (編集時の親マニフェスト参照) の削除は **Task 02 で完了済み** の前提。本タスクでは EditScreen 撤去 + 関連 navigation routing 削除に集中
- React Navigation の routing 定義から `Edit` を削除
- `RegistrationScreen` への遷移を CameraScreen から直接

将来 (v0.1.2 以降) に編集機能を再追加する場合は、新しい設計で組み直す前提。

### Phase 5: カメラロール選択フロー — PENDING

- `expo-image-picker` を使って既存メディア選択
- 選択されたファイルは **既に署名済みの可能性 / 未署名の可能性** がある
  - 署名済み: c2pa-bridge `read_manifest` で確認 → そのまま Registration へ
  - 未署名: Registration 側で「このコンテンツは RootLens で撮影されていません」表示 + sensor assertion なしで TP 登録 (Title Protocol 仕様で RootLens 以外のコンテンツも登録可能か要確認)
- 撮影と同じ Registration 画面に到達する

### Phase 6: 統合検証 — PENDING

- 撮影画面が実機で安定動作 (プレビュー描画 / フォーカス / ズーム / 撮影 / モード切替)
- EditScreen 撤去後のフロー (撮影 → Registration) が滑らか
- カメラロール選択フローが動く
- 静止画 / 動画 / カメラロール選択の3経路で Publishing まで到達

## スコープ外

- 編集機能 (クロップ / マスク / トリミング) は v0.1.1 で削除。再導入は v0.1.2 以降
- depth プレビュー (撮影中に depth を可視化するインジケータ) は将来検討
- TP Extension / 公開ページ (Task 06)

## 完了条件

- [ ] iOS / Android のネイティブ Preview View が Expo Modules API で RN に露出
- [ ] CameraScreen が新 Preview View + シャッター UI で動作
- [ ] ズーム / フォーカス / フラッシュ / orientation / カメラ切替の UX
- [ ] 静止画 / 動画モード切替
- [ ] EditScreen 撤去 + 関連コード削除
- [ ] カメラロール選択フロー実装
- [ ] 撮影 / 動画 / カメラロール選択の3経路が Publishing まで到達

## 完了日: TBD

## ディレクトリ構成 (予定)

```
app/
├── src/
│   ├── screens/
│   │   ├── CameraScreen.tsx        (Preview View + シャッター UI)
│   │   ├── GalleryScreen.tsx       (カメラロール選択)
│   │   ├── RegistrationScreen.tsx  (撮影/選択両経路の遷移先)
│   │   └── EditScreen.tsx          (削除)
│   └── components/
│       └── SensorPreviewView.tsx    (ネイティブビューラッパー)
│
└── modules/sensor-session/
    ├── ios/
    │   └── PreviewView.swift        (新規)
    └── android/
        └── src/main/java/io/rootlens/sensorsession/
            └── PreviewView.kt        (新規)
```

## 並列調査が必要な項目 (実装中にエージェントで補強)

- Expo Modules API での Native View 露出パターン (View / ViewManager の実装)
- iOS AVCaptureVideoPreviewLayer の SwiftUI / UIKit 接続最善策
- Android SurfaceView vs TextureView のトレードオフ
- Camera ISensor とプレビュー Surface のライフサイクル分離設計
- カメラロール選択時の C2PA 署名済み判定と未署名コンテンツの TP 登録可否

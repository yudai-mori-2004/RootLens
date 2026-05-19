# Task 13: Unit C — Privacy blur (face-only, on-device)

統合フェーズでそのまま使う production-bound ユニット。SPECS §2.3 step 7「プライバシー処理」のうち**顔のブラー部分のみ**を、撮影完了後の mp4 から作る最小実装。

## 役割

iOS デバイス上で input mp4 を受け取り、各フレームの顔領域を Vision で検出して Gaussian blur をかけた mp4 を出力する。クライアントから:

```ts
processPrivacyBlur({
  inputUri: "file:///path/to/recording.mp4",
  blurRadius: 32,
  detectionScale: 0.66,
  faceInflate: 0.18,
}, onProgress);
```

を呼ぶと、

```ts
{
  outputUri: "file:///tmp/recording_blurred.mp4",
  durationMs: 87421,
  framesProcessed: 9000,
  facesBlurred: 12340,    // 全フレーム合計、重複あり
  inputBytes: 52_300_000,
  outputBytes: 48_900_000,
  outputWidth: 1080,
  outputHeight: 1920,
}
```

を返す。これだけ。アップロードや TP register などの後段との連携は持たない (caller が `outputUri` を次のステップに渡す)。

## なぜ顔のみ

SPECS §2.5 を 2026-05 に更新し、 「テキストぼかしは行わない」 ことを設計判断として明示した。 業界標準 (= Meta EgoBlur 公式 / Brighter AI / Celantur) も face + license plate のみ。 egocentric 視点の任意シーンテキストを 100% blur する技術は現時点で存在せず (= EasyOCR / DBNet / PP-OCRv5 のいずれも recall 50-70% / false positive 多発)、 「ぼかした」 と claim できない blur は逆に誤解を招く。 個人情報を含む書類・画面の写り込みは scenario design (= 撮影 task の指示) + 撮影者の consent flow で担保する。

参考: iOS 側で試した技術的制約:

1. `VNRecognizeTextRequest` は recognizer であって detector ではない。読めなかった text は output に含まれず、PC 画面のような密集シーンで recall hole が出る
2. .fast / .accurate どちらも non-frontal な視点 (机上の書類を斜め下から見る、傾いた画面など) で recall が崩れる
3. 4-pass orientation OCR (0/90/180/270°) を試しても、回転 input でテクスチャ (床の継ぎ目、布の織目) を文字と誤認する false positive が大量に出る
4. confidence threshold + min text length + minimumTextHeight でフィルタしても recall ↔ false positive のトレードオフは解消しない
5. iOS 26 / WWDC25-26 でも純粋な text-region detector は未提供。`RecognizeDocumentsRequest` は recognizer ベース

## API (TypeScript)

`app/src/units/privacy-blur/index.ts`:

```ts
export interface PrivacyBlurOptions {
  inputUri: string;          // file:// or absolute path
  outputUri?: string;        // 省略時は temp に作成
  blurRadius?: number;       // default 32 (px)
  detectionScale?: number;   // default 0.66 (検出時のダウンサンプル)
  faceInflate?: number;      // default 0.18 (毛髪・顎まで覆う)
}

export interface PrivacyBlurResult {
  outputUri: string;
  durationMs: number;
  framesProcessed: number;
  facesBlurred: number;
  inputBytes: number;
  outputBytes: number;
  outputWidth: number;
  outputHeight: number;
}

export interface PrivacyBlurProgress {
  progress: number;         // 0..1
  framesDone: number;
  totalFrames: number;
}

export function processPrivacyBlur(
  options: PrivacyBlurOptions,
  onProgress?: (p: PrivacyBlurProgress) => void
): Promise<PrivacyBlurResult>;

export function isPrivacyBlurAvailable(): boolean;
```

## 実装方針

### iOS (`app/modules/privacy-blur/ios/`)

ネイティブ pipeline (`PrivacyBlurProcessor.swift`):

1. `AVAssetReader` で input mp4 を BGRA pixel buffer として読み出す
2. `preferredTransform` を CIImage に焼き込んで「常に upright」表示状態にする (writer 側で transform を持たせない、ピクセルにベイクする)
3. 各フレーム:
   - Vision `VNDetectFaceRectanglesRequest` (revision 3) で顔矩形を検出 (毎フレーム、3-8ms)
   - 検出 bbox を `faceInflate` で拡張、unit rect で clamp
   - 全領域を白で描いた mask CIImage を構築 (mask 境界はソフトブラー)
   - 元画像に `CIGaussianBlur` をかけたものを `CIBlendWithMask` で合成
4. `AVAssetWriter` (HEVC, transform=identity) に upright pixel buffer として書き出す

検出時のダウンサンプル:
- `detectionScale = 0.66` で 1080p → ~720p 相当でデテクション → 計算量を約半分に
- ブラー合成は元解像度で行うので画質劣化なし

CIContext は Metal-backed (`MTLCreateSystemDefaultDevice()`) を使用。

### Expo Module 表面 (`app/modules/privacy-blur/`)

```
expo-module.config.json   ←  platforms: ["ios"], _android_intentionally_omitted
ios/
  privacy_blur.podspec    ←  Vision/CoreImage/Metal/AVFoundation/VideoToolbox/CoreVideo/CoreMedia
  PrivacyBlurModule.swift ←  Expo AsyncFunction("process") + Events("onProgress")
  PrivacyBlurProcessor.swift  ←  メインの pipeline 実装
android/
  README.md               ←  intentionally empty (後続タスク)
```

Pod 設定:
```ruby
s.platform = :ios, '15.1'
s.pod_target_xcconfig = { 'SWIFT_STRICT_CONCURRENCY' => 'minimal' }
```

`SWIFT_STRICT_CONCURRENCY=minimal` は AVFoundation 系の `@Sendable` warning が大量に出るのを抑える (AVAssetWriterInput.requestMediaDataWhenReady の closure)。AVFoundation が Sendable annotation を整備したら外す。

### Sandbox driver (`app/src/sandboxes/05-privacy-blur/`)

`05-privacy-blur` は他サンドボックスに依存しない自己完結 driver:
- HandPosePreviewView でカメラプレビュー
- `startHandPoseRecording` / `stopHandPoseRecording` で sandbox 内録画
- 停止 → `processPrivacyBlur` → before/after プレイヤー表示 + 統計

sandbox 04 のクリップを拾う path は持たない (sandbox 独立性原則)。

## 性能目標

5-min 1080p mp4 を:
- iPhone 14/15: **1-2 min wall time**
- iPhone 16+:   **<1 min**

ボトルネックは Vision face detect (3-8ms/frame × 9000 frames = 27-72s) + HEVC エンコード (HW encoder で律速にならない)。

## 信頼境界

- **入力で信頼するもの**: input mp4 のフォーマットのみ。`AVAssetReader` が読めなければ throw
- **顔検出の真正性**: Vision の出力をそのまま使う。誤検出 (false positive で背景の一部を顔判定して blur) はあり得るが、privacy fail-safe としては安全側
- **output の改竄保証**: 本ユニットの責務外。改竄検出は §2.7 の C2PA 署名 (Unit A) が後段で署名し直すレイヤーで担保

## Audit-grade テスト

ネイティブ pipeline の特性上、**実機 sandbox driver でのスモーク** + **JS-level smoke test** を組み合わせる。fully unit-isolated な vitest はネイティブ pipeline を呼べないため不可。

### Sandbox 05 driver で確認 (実機, iPhone 14+)

- [ ] 顔が映る 5-10 秒のクリップを録画 → blur 実行 → 出力プレイヤーで顔がブラーされていることを目視確認
- [ ] 顔が映らないクリップ → blur 実行 → output mp4 が input と同等の見た目で再生可能 (誤検出で全体に blur が掛かったりしない)
- [ ] 横向き保持で録画 → output mp4 が縦向き / 横向きどちらでも player で正しく再生される (preferredTransform ベイクの動作確認)
- [ ] スループット計測: framesProcessed / durationMs が iPhone 14/15 で 30-90 fps、iPhone 16+ で 60-150 fps

### JS API smoke test (`app/src/units/privacy-blur/__tests__/index.test.ts`)

ネイティブ未ロード環境 (Jest) で:
- `isPrivacyBlurAvailable()` が `false` を返す
- `processPrivacyBlur({...})` が `"PrivacyBlur native module unavailable"` で reject する

これは「JS 側 API が module 未ロード時に正しく fail する」最小保証。実 pipeline の test は実機 driver。

### regression guard

- output mp4 が CoreVideo/AVFoundation で読み戻せること (壊れた mp4 を出さないこと)
- `outputBytes > 0` かつ `framesProcessed === input frame count`

## env

なし。

## 完了条件

- [x] `app/modules/privacy-blur/ios/PrivacyBlurModule.swift` (AsyncFunction `process`, Events `onProgress`)
- [x] `app/modules/privacy-blur/ios/PrivacyBlurProcessor.swift` (AVAssetReader → Vision → CIGaussianBlur → CIBlendWithMask → AVAssetWriter)
- [x] `app/modules/privacy-blur/ios/privacy_blur.podspec` (frameworks + SWIFT_STRICT_CONCURRENCY=minimal)
- [x] `app/modules/privacy-blur/expo-module.config.json` (iOS only declared)
- [x] `app/modules/privacy-blur/android/README.md` (placeholder)
- [x] `app/src/units/privacy-blur/index.ts` (TS API surface, `processPrivacyBlur` + `isPrivacyBlurAvailable`)
- [x] `app/src/sandboxes/05-privacy-blur/PrivacyBlurScreen.tsx` (record + blur 自己完結 driver)
- [ ] `app/src/units/privacy-blur/__tests__/index.test.ts` (JS-level smoke test)
- [ ] iPhone 14+ 実機で sandbox 05 を通して上記 audit checklist 全パス

## スコープ外

- **テキスト blur** — §2.5 の設計判断により scope 外 (= future task としても予定しない)。 業界標準と同じく顔のみ
- **顔以外の身体部位 blur** (体型/手の傷など) — 仕様書で要求されてない
- **オブジェクト blur** (車のナンバープレート、住所表記の看板) — 仕様書で要求されてない
- **Android** — 本ユニットは iOS のみ。MediaCodec + GLES + ML Kit で同等パイプラインを組む後続タスク
- **リアルタイム blur (撮影中)** — 撮影フローは sandbox 04 / hand-pose ユニットの責務。本ユニットは録画完了後の post-process 専用
- **C2PA 再署名** — blur 後の mp4 は元の C2PA 署名を破壊する。再署名は §2.7 の Unit A (TEE + C2PA) の責務

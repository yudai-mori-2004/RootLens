import ExpoModulesCore

// On-device privacy blur (iOS / Vision + CoreImage)。
//
// 提供:
//   - AsyncFunction("process") — mp4 を受け取り、顔と OCR テキスト領域をブラーした mp4 を出力
//   - Event("onProgress") — フレーム単位の進捗 (0..1)
//
// 設計:
//   - PrivacyBlurProcessor が AVAssetReader/Writer + Vision + CoreImage の pipeline を own
//   - Module は薄い橋渡し層。重い state は持たない。
//   - 使い方は SPECS §2.3 step 7-8: 撮影完了 → process(mp4) → ユーザー承認 → step 9
//
// 性能想定 (調査結果より、5min 1080p mp4):
//   - iPhone 14/15 + .fast OCR で 1-3min wall time
//   - iPhone 16+ で <2min
//   - Vision face detect は 3-8ms/frame、OCR.fast は 30-80ms/frame、HW encoder は律速にならない

public class PrivacyBlurModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PrivacyBlur")

    Events("onProgress")

    AsyncFunction("process") { (args: PrivacyBlurArgs, promise: Promise) in
      let opts = args.toOptions()
      Task.detached(priority: .userInitiated) { [weak self] in
        do {
          let result = try await PrivacyBlurProcessor.process(opts) { progress, framesDone, totalFrames in
            self?.sendEvent("onProgress", [
              "progress": progress,
              "framesDone": framesDone,
              "totalFrames": totalFrames,
            ])
          }
          promise.resolve(result.toDictionary())
        } catch {
          promise.reject("PRIVACY_BLUR_ERROR", error.localizedDescription)
        }
      }
    }

  }
}

// JS から渡される options。Expo Modules の Record で named-args を受ける。
struct PrivacyBlurArgs: Record {
  @Field var inputUri: String = ""
  @Field var outputUri: String? = nil
  @Field var blurRadius: Double = 32.0
  @Field var detectionScale: Double = 0.66   // 検出時のダウンサンプル比 (0.5-1.0)
  @Field var faceInflate: Double = 0.18       // 検出 bbox の拡張率 (毛髪・顎まで覆う)

  func toOptions() -> PrivacyBlurOptions {
    return PrivacyBlurOptions(
      inputUri: inputUri,
      outputUri: outputUri,
      blurRadius: max(4.0, blurRadius),
      detectionScale: max(0.25, min(1.0, detectionScale)),
      faceInflate: max(0.0, faceInflate)
    )
  }
}

import ExpoModulesCore
import Foundation

// AVCaptureSession ベース撮影モジュールの Expo ブリッジ。
//
// 2026-05-27 方針転換: ARKit (= arkit-capture) を廃止して ultra-wide camera に切替えた
// 新モジュール。 API shape は arkit-capture と同形 (= main session の JS wrapper が
// 切替えやすいように)。 段階削除整合のため arkit-capture と並走させる。
//
// 提供:
//   View: <WideCapturePreviewView />      AVCaptureVideoPreviewLayer
//   Event: onHandTrack                    Vision HandPose 結果を都度配信 (= arkit-capture 同形 payload)
//   AsyncFunction("startSession")         AVCaptureSession 起動
//   AsyncFunction("stopSession")          AVCaptureSession 停止
//   AsyncFunction("startRecording", path) 超広角構成ファイル並走出力開始 (= rgb.mp4 + realtime_handpose.jsonl + metadata.json)
//   AsyncFunction("stopRecording")        出力停止 + finalize、 sessionDir URI 返す
//   AsyncFunction("captureSnapshot")      最新フレーム → JPEG → temp file:// URI
//   AsyncFunction("isAvailable")          .builtInUltraWideCamera 利用可否
//   AsyncFunction("setDisplayOrientation", value: "portrait" | "landscapeLeft" | "landscapeRight")

public class WideCaptureModule: Module, WideCaptureControllerDelegate {

  public func definition() -> ModuleDefinition {
    Name("WideCapture")

    Events("onHandTrack")

    OnCreate {
      WideCaptureController.shared.delegate = self
    }

    View(WideCapturePreviewView.self) {}

    AsyncFunction("startSession") { (promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        WideCaptureController.shared.startSession()
        promise.resolve(nil)
      }
    }

    AsyncFunction("stopSession") { (promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        WideCaptureController.shared.stopSession()
        promise.resolve(nil)
      }
    }

    // sessionDir を引数に取り、 そこに rgb.mp4 + realtime_handpose.jsonl + metadata.json を
    // 並走出力する。 空文字なら temp 配下に session ディレクトリを生成する。
    AsyncFunction("startRecording") { (sessionDirPath: String, promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          let dir: URL
          if sessionDirPath.isEmpty {
            let tmp = NSTemporaryDirectory()
            let ts = Int(Date().timeIntervalSince1970)
            dir = URL(fileURLWithPath: "\(tmp)rootlens_widesession_\(ts)/")
          } else {
            dir = URL(fileURLWithPath: sessionDirPath)
          }
          let outDir = try WideCaptureController.shared.startRecording(sessionDir: dir)
          promise.resolve(outDir.absoluteString)
        } catch {
          promise.reject("WIDE_CAPTURE_START_ERROR", error.localizedDescription)
        }
      }
    }

    AsyncFunction("stopRecording") { (promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          let url = try WideCaptureController.shared.stopRecording()
          promise.resolve(url.absoluteString)
        } catch {
          promise.reject("WIDE_CAPTURE_STOP_ERROR", error.localizedDescription)
        }
      }
    }

    AsyncFunction("captureSnapshot") { (promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          let url = try WideCaptureController.shared.captureSnapshot()
          promise.resolve(url.absoluteString)
        } catch {
          promise.reject("WIDE_CAPTURE_SNAPSHOT_ERROR", error.localizedDescription)
        }
      }
    }

    AsyncFunction("isAvailable") { () -> Bool in
      return WideCaptureController.isUltraWideAvailable()
    }

    AsyncFunction("setDisplayOrientation") { (value: String, promise: Promise) in
      let o: WideCaptureDisplayOrientation = {
        switch value {
        case "portrait":        return .portrait
        case "landscapeLeft":   return .landscapeLeft
        case "landscapeRight":  return .landscapeRight
        default:                return .landscapeRight
        }
      }()
      WideCaptureController.shared.setDisplayOrientation(o)
      promise.resolve(nil)
    }
  }

  // MARK: - WideCaptureControllerDelegate

  func wideCapture(didTrackHand output: HandTracker.Output) {
    let payload = buildHandTrackPayload(output)
    sendEvent("onHandTrack", payload)
  }

  /// arkit-capture と完全同形 payload (= main session の JS wrapper を共通化)。
  /// 新仕様で撤去された segmentationCoverage / segmentationEdgeRatio は 0.0 固定で送る
  /// (= JS 側は無視、 hand framing 判定自体が撤去済み)。
  private func buildHandTrackPayload(_ out: HandTracker.Output) -> [String: Any] {
    let wearerHands: [[String: Any]] = out.classification.hands
      .filter { $0.isWearer }
      .map { ch in
        let lms: [[String: Float]] = ch.raw.landmarks.map { lm in
          return ["x": lm.x, "y": lm.y, "confidence": lm.confidence]
        }
        return [
          "handedness": ch.raw.handedness,
          "confidence": ch.raw.confidence,
          "landmarks": lms,
          // per-hand のジェスチャー (= 集約は TS 側)。 検出不能は null。
          "gesture": WearerHandClassifier.detectGesture(hand: ch.raw)?.rawValue ?? NSNull(),
        ]
      }
    return [
      "timestampNs": String(out.timestampNs),
      "imageWidth": out.imageWidth,
      "imageHeight": out.imageHeight,
      "wearerHandCount": out.classification.wearerHandCount,
      "wearerHands": wearerHands,
      "segmentationCoverage": out.segmentationCoverage,
      "segmentationEdgeRatio": out.segmentationEdgeRatio,
    ]
  }
}

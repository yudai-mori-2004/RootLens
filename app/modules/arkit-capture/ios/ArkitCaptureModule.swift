import ARKit
import ExpoModulesCore
import Foundation

// ARKit ベース撮影モジュールの Expo ブリッジ。
//
// 提供:
//   View: <ArkitCapturePreviewView />     ARSession のプレビュー描画
//   Event: onHandTrack                    15 Hz で手の検出結果を流す
//   AsyncFunction("startRecording", path) MP4 録画開始 (= AVAssetWriter H.264)、 返値 file:// URI
//   AsyncFunction("stopRecording")        MP4 録画停止、 返値 file:// URI
//   AsyncFunction("captureSnapshot")      最新フレームを JPEG 化して URI を返す (VLM 用)
//   AsyncFunction("startSession")         ARSession 起動 (プレビュー描画 + HandTracker)
//   AsyncFunction("stopSession")          ARSession 停止
//   AsyncFunction("isAvailable")          ARWorldTrackingConfiguration 対応か

public class ArkitCaptureModule: Module, ArkitCaptureControllerDelegate {

  public func definition() -> ModuleDefinition {
    Name("ArkitCapture")

    Events("onHandTrack", "onThermalState")

    OnCreate {
      ArkitCaptureController.shared.delegate = self
    }

    View(ArkitCapturePreviewView.self) {}

    AsyncFunction("startSession") { (promise: Promise) in
      DispatchQueue.main.async {
        ArkitCaptureController.shared.startSession()
        promise.resolve(nil)
      }
    }

    AsyncFunction("stopSession") { (promise: Promise) in
      DispatchQueue.main.async {
        ArkitCaptureController.shared.stopSession()
        promise.resolve(nil)
      }
    }

    // sessionDir を引数に取り、 そこに rgb.mp4 + realtime_handpose.jsonl + imu.jsonl
    // + camera_intrinsics.json を並走出力する。 空文字なら temp 配下に session ディレクトリを生成する。
    AsyncFunction("startRecording") { (sessionDirPath: String, promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          let dir: URL
          if sessionDirPath.isEmpty {
            let tmp = NSTemporaryDirectory()
            let ts = Int(Date().timeIntervalSince1970)
            dir = URL(fileURLWithPath: "\(tmp)rootlens_session_\(ts)/")
          } else {
            dir = URL(fileURLWithPath: sessionDirPath)
          }
          let outDir = try ArkitCaptureController.shared.startRecording(sessionDir: dir)
          promise.resolve(outDir.absoluteString)
        } catch {
          promise.reject("ARKIT_CAPTURE_START_ERROR", error.localizedDescription)
        }
      }
    }

    AsyncFunction("stopRecording") { (promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          let url = try ArkitCaptureController.shared.stopRecording()
          promise.resolve(url.absoluteString)
        } catch {
          promise.reject("ARKIT_CAPTURE_STOP_ERROR", error.localizedDescription)
        }
      }
    }

    AsyncFunction("captureSnapshot") { (promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          let url = try ArkitCaptureController.shared.captureSnapshot()
          promise.resolve(url.absoluteString)
        } catch {
          promise.reject("ARKIT_CAPTURE_SNAPSHOT_ERROR", error.localizedDescription)
        }
      }
    }

    // 撮影設定 (JSON)。 次の startSession / startRecording から適用される。
    AsyncFunction("setCaptureSettings") { (json: String, promise: Promise) in
      ArkitCaptureController.shared.applyCaptureSettings(json: json)
      promise.resolve(nil)
    }

    AsyncFunction("isAvailable") { () -> Bool in
      return ARWorldTrackingConfiguration.isSupported
    }

    // 画面消灯 (= 長時間録画の省電力・発熱対策): 輝度 0 + プレビュー描画停止。 false で復帰。
    AsyncFunction("setScreenDimmed") { (dimmed: Bool, promise: Promise) in
      DispatchQueue.main.async {
        ArkitCaptureController.shared.setScreenDimmed(dimmed)
        promise.resolve(nil)
      }
    }

    // 現在の熱状態。 録画中の変化は onThermalState イベントで届く。
    AsyncFunction("getThermalState") { () -> String in
      return ArkitCaptureController.thermalStateString(ProcessInfo.processInfo.thermalState)
    }

    AsyncFunction("setDisplayOrientation") { (value: String, promise: Promise) in
      let o: DisplayOrientation = {
        switch value {
        case "portrait":        return .portrait
        case "landscapeLeft":   return .landscapeLeft
        case "landscapeRight":  return .landscapeRight
        default:                return .portrait
        }
      }()
      ArkitCaptureController.shared.setDisplayOrientation(o)
      promise.resolve(nil)
    }
  }

  // MARK: - ArkitCaptureControllerDelegate

  func arkitCapture(didTrackHand output: HandTracker.Output) {
    let payload = buildHandTrackPayload(output)
    sendEvent("onHandTrack", payload)
  }

  func arkitCapture(didChangeThermalState state: String) {
    sendEvent("onThermalState", ["state": state])
  }

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
      // セグメンテーションで計算した「人」 ピクセル割合 (= フレーミング判定の主信号)
      "segmentationCoverage": out.segmentationCoverage,
      "segmentationEdgeRatio": out.segmentationEdgeRatio,
    ]
  }
}

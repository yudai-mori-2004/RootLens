import ARKit
import AVFoundation
import ExpoModulesCore
import Foundation
import UIKit

// Expo bridge of the ARKit capture module.
//
// Surface:
//   View: <ArkitCapturePreviewView />     renders the ARSession preview
//   Event: onHandTrack                    hand-detection results at ~15 Hz
//   AsyncFunction("startRecording", path) start MP4 recording (AVAssetWriter H.264); resolves to a file:// URI
//   AsyncFunction("stopRecording")        stop recording; resolves to a file:// URI
//   AsyncFunction("captureSnapshot")      write the latest frame as JPEG and return its URI
//   AsyncFunction("startSession")         start the ARSession (preview + HandTracker)
//   AsyncFunction("stopSession")          stop the ARSession
//   AsyncFunction("isAvailable")          whether ARWorldTrackingConfiguration is supported

public class ArkitCaptureModule: Module, ArkitCaptureControllerDelegate {

  public func definition() -> ModuleDefinition {
    Name("ArkitCapture")

    Events(
      "onHandTrack",
      "onThermalState",
      "onVoiceCommand",
      "onVoiceUnavailable",
      "onMarkerCommand"
    )

    OnCreate {
      ArkitCaptureController.shared.delegate = self
      SpeechCommandController.shared.onCommand = { [weak self] command, transcript in
        self?.sendEvent("onVoiceCommand", ["command": command, "transcript": transcript])
      }
      SpeechCommandController.shared.onUnavailable = { [weak self] message in
        self?.sendEvent("onVoiceUnavailable", ["message": message])
      }
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

    // Takes a session dir and writes the recording outputs (rgb.mp4,
    // frames.jsonl, imu.jsonl, metadata.json, depth.tar on LiDAR
    // devices) into it concurrently. An empty string creates a dir under temp.
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
      // Take background execution time so files still close cleanly when the stop
      // comes from the JS AppState handler during backgrounding. Keep 5 extra
      // seconds after the writer closes for the JS-side ledger registration.
      var bgTask: UIBackgroundTaskIdentifier = .invalid
      bgTask = UIApplication.shared.beginBackgroundTask(withName: "rootlens-stop-recording") {
        if bgTask != .invalid { UIApplication.shared.endBackgroundTask(bgTask); bgTask = .invalid }
      }
      DispatchQueue.global(qos: .userInitiated).async {
        defer {
          DispatchQueue.main.asyncAfter(deadline: .now() + 5.0) {
            if bgTask != .invalid { UIApplication.shared.endBackgroundTask(bgTask); bgTask = .invalid }
          }
        }
        do {
          let url = try ArkitCaptureController.shared.stopRecording()
          promise.resolve(url.absoluteString)
        } catch {
          NSLog("[ArkitCaptureController] stopRecording threw: %@",
                ArkitCaptureController.describeNSError(error))
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

    // Capture settings (JSON). Apply from the next startSession / startRecording.
    AsyncFunction("setCaptureSettings") { (json: String, promise: Promise) in
      ArkitCaptureController.shared.applyCaptureSettings(json: json)
      promise.resolve(nil)
    }

    AsyncFunction("isAvailable") { () -> Bool in
      return ARWorldTrackingConfiguration.isSupported
    }

    // Analyze a short temporary recording made through the same startRecording /
    // stopRecording path as production capture. Vision never competes with the
    // live ARSession for its recycled pixel buffers.
    AsyncFunction("analyzeCameraImuTimeValidation") { (sessionDirPath: String, promise: Promise) in
      let path = sessionDirPath.replacingOccurrences(of: "file://", with: "")
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          let estimate = try CameraImuTimeCalibrator.analyzeRecording(
            at: URL(fileURLWithPath: path, isDirectory: true))
          DispatchQueue.main.async {
            let value = ArkitCaptureController.shared.storeCameraImuTimeValidation(estimate)
            promise.resolve(value)
          }
        } catch {
          promise.reject("CAMERA_IMU_TIME_VALIDATION_ERROR", error.localizedDescription)
        }
      }
    }

    AsyncFunction("getCameraImuTimeValidation") { () -> [String: Any]? in
      return ArkitCaptureController.shared.lastCameraImuTimeValidation()
    }

    // Voice capture flow: listen for spoken start/stop commands. On-device
    // ja-JP recognition; transcripts are transient and never stored.
    AsyncFunction("startVoiceCommands") { (promise: Promise) in
      DispatchQueue.main.async {
        SpeechCommandController.shared.start { error in
          if let error {
            promise.reject("VOICE_COMMANDS_START_ERROR", error.localizedDescription)
          } else {
            promise.resolve(nil)
          }
        }
      }
    }

    AsyncFunction("stopVoiceCommands") { (promise: Promise) in
      DispatchQueue.main.async {
        SpeechCommandController.shared.stop()
        promise.resolve(nil)
      }
    }

    // Rewrite an MP4 with faststart (moov atom to the front), no re-encode
    // (passthrough). A faststarted upload begins streaming playback immediately,
    // regardless of clip length.
    AsyncFunction("faststartMp4") { (inputPath: String, outputPath: String, promise: Promise) in
      let inURL = URL(fileURLWithPath: inputPath.replacingOccurrences(of: "file://", with: ""))
      let outURL = URL(fileURLWithPath: outputPath.replacingOccurrences(of: "file://", with: ""))
      try? FileManager.default.removeItem(at: outURL)
      let asset = AVURLAsset(url: inURL)
      guard let export = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetPassthrough) else {
        promise.reject("FASTSTART_ERROR", "cannot create export session")
        return
      }
      export.outputURL = outURL
      export.outputFileType = .mp4
      export.shouldOptimizeForNetworkUse = true  // moov to the front = faststart
      export.exportAsynchronously {
        switch export.status {
        case .completed:
          promise.resolve(outURL.absoluteString)
        default:
          promise.reject("FASTSTART_ERROR",
                         export.error?.localizedDescription ?? "export status \(export.status.rawValue)")
        }
      }
    }

    // Diagnostics: the app's current memory footprint (phys_footprint, MB). Used
    // to investigate upload OOMs.
    AsyncFunction("getMemoryFootprintMB") { () -> Double in
      var info = task_vm_info_data_t()
      var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size) / 4
      let kr = withUnsafeMutablePointer(to: &info) { ptr in
        ptr.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
          task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
        }
      }
      return kr == KERN_SUCCESS ? Double(info.phys_footprint) / 1_000_000.0 : -1
    }

    // Screen off (power / heat relief for long recordings): brightness to zero
    // and preview rendering paused. false restores.
    AsyncFunction("setScreenDimmed") { (dimmed: Bool, promise: Promise) in
      DispatchQueue.main.async {
        ArkitCaptureController.shared.setScreenDimmed(dimmed)
        promise.resolve(nil)
      }
    }

    // Suppress auto-lock (true while the capture screen is open; independent of the ARSession).
    AsyncFunction("setKeepAwake") { (on: Bool, promise: Promise) in
      DispatchQueue.main.async {
        ArkitCaptureController.shared.setKeepAwake(on)
        promise.resolve(nil)
      }
    }

    // Current thermal state. Changes during recording arrive via the onThermalState event.
    AsyncFunction("getThermalState") { () -> String in
      return ArkitCaptureController.thermalStateString(ProcessInfo.processInfo.thermalState)
    }

    // Battery level (0..1, -1 when unknown) and charging state. Drives the long-recording auto-stop.
    AsyncFunction("getPowerState") { (promise: Promise) in
      DispatchQueue.main.async {
        UIDevice.current.isBatteryMonitoringEnabled = true
        let state = UIDevice.current.batteryState
        promise.resolve([
          "level": UIDevice.current.batteryLevel,
          "charging": state == .charging || state == .full,
        ])
      }
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

  func arkitCapture(didDetectMarker payload: String) {
    sendEvent("onMarkerCommand", ["payload": payload])
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
          // Per-hand gesture (aggregation happens on the TS side). null when undecidable.
          "gesture": WearerHandClassifier.detectGesture(hand: ch.raw)?.rawValue ?? NSNull(),
        ]
      }
    return [
      "timestampNs": String(out.timestampNs),
      "imageWidth": out.imageWidth,
      "imageHeight": out.imageHeight,
      "wearerHandCount": out.classification.wearerHandCount,
      "wearerHands": wearerHands,
      // Person-pixel fractions from segmentation (the primary framing signal).
      "segmentationCoverage": out.segmentationCoverage,
      "segmentationEdgeRatio": out.segmentationEdgeRatio,
    ]
  }
}

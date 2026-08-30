import AVFoundation
import ExpoModulesCore
import Foundation
import UIKit

public class IphoneCaptureModule: Module, IphoneCaptureControllerDelegate {
  public func definition() -> ModuleDefinition {
    Name("IphoneCapture")
    Events("onHandTrack")

    OnCreate {
      IphoneCaptureController.shared.delegate = self
    }

    View(IphoneCapturePreviewView.self) {}

    AsyncFunction("isAvailable") { () -> Bool in
      IphoneCaptureController.isAvailable()
    }

    AsyncFunction("startSession") { (promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          try IphoneCaptureController.shared.startSession()
          promise.resolve(nil)
        } catch {
          promise.reject("IPHONE_CAPTURE_SESSION_ERROR", error.localizedDescription)
        }
      }
    }

    AsyncFunction("stopSession") { (promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        IphoneCaptureController.shared.stopSession()
        promise.resolve(nil)
      }
    }

    AsyncFunction("startRecording") { (sessionDirPath: String, promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          let directory: URL
          if sessionDirPath.isEmpty {
            directory = URL(fileURLWithPath: NSTemporaryDirectory())
              .appendingPathComponent("rootlens_iphone_\(Int(Date().timeIntervalSince1970))", isDirectory: true)
          } else {
            directory = URL(fileURLWithPath: sessionDirPath, isDirectory: true)
          }
          let result = try IphoneCaptureController.shared.startRecording(sessionDir: directory)
          promise.resolve(result.absoluteString)
        } catch {
          promise.reject("IPHONE_CAPTURE_START_ERROR", error.localizedDescription)
        }
      }
    }

    AsyncFunction("stopRecording") { (promise: Promise) in
      var backgroundTask: UIBackgroundTaskIdentifier = .invalid
      backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "rootlens-iphone-stop") {
        if backgroundTask != .invalid {
          UIApplication.shared.endBackgroundTask(backgroundTask)
          backgroundTask = .invalid
        }
      }
      DispatchQueue.global(qos: .userInitiated).async {
        defer {
          DispatchQueue.main.asyncAfter(deadline: .now() + 5) {
            if backgroundTask != .invalid {
              UIApplication.shared.endBackgroundTask(backgroundTask)
              backgroundTask = .invalid
            }
          }
        }
        do {
          let result = try IphoneCaptureController.shared.stopRecording()
          promise.resolve(result.absoluteString)
        } catch {
          promise.reject("IPHONE_CAPTURE_STOP_ERROR", error.localizedDescription)
        }
      }
    }

    AsyncFunction("setCaptureSettings") { (json: String, promise: Promise) in
      IphoneCaptureController.shared.applyCaptureSettings(json: json)
      promise.resolve(nil)
    }

    AsyncFunction("captureSnapshot") { (promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        do { promise.resolve(try IphoneCaptureController.shared.captureSnapshot().absoluteString) }
        catch { promise.reject("IPHONE_CAPTURE_SNAPSHOT_ERROR", error.localizedDescription) }
      }
    }

    AsyncFunction("setDisplayOrientation") { (value: String, promise: Promise) in
      let orientation: DisplayOrientation
      switch value {
      case "landscapeLeft": orientation = .landscapeLeft
      case "landscapeRight": orientation = .landscapeRight
      default: orientation = .portrait
      }
      IphoneCaptureController.shared.setDisplayOrientation(orientation)
      promise.resolve(nil)
    }

    AsyncFunction("analyzeCameraImuTimeValidation") { (sessionDirPath: String, promise: Promise) in
      let path = sessionDirPath.replacingOccurrences(of: "file://", with: "")
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          let estimate = try CameraImuTimeCalibrator.analyzeRecording(
            at: URL(fileURLWithPath: path, isDirectory: true))
          let value = IphoneCaptureController.shared.storeCameraImuTimeValidation(estimate)
          promise.resolve(value)
        } catch {
          promise.reject("IPHONE_CAMERA_IMU_VALIDATION_ERROR", error.localizedDescription)
        }
      }
    }

    AsyncFunction("getCameraImuTimeValidation") { () -> [String: Any]? in
      IphoneCaptureController.shared.lastCameraImuTimeValidation()
    }
  }

  func iphoneCapture(didTrackHand output: HandTracker.Output) {
    let hands: [[String: Any]] = output.classification.hands
      .filter(\.isWearer)
      .map { classified in
        [
          "handedness": classified.raw.handedness,
          "confidence": classified.raw.confidence,
          "landmarks": classified.raw.landmarks.map { landmark in
            ["x": landmark.x, "y": landmark.y, "confidence": landmark.confidence]
          },
          "gesture": WearerHandClassifier.detectGesture(hand: classified.raw)?.rawValue ?? NSNull(),
        ]
      }
    sendEvent("onHandTrack", [
      "timestampNs": String(output.timestampNs),
      "imageWidth": output.imageWidth,
      "imageHeight": output.imageHeight,
      "wearerHandCount": output.classification.wearerHandCount,
      "wearerHands": hands,
      "segmentationCoverage": 0.0,
      "segmentationEdgeRatio": 0.0,
    ])
  }
}

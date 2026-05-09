import ExpoModulesCore

// Hand pose ネイティブモジュール (iOS / Vision)。
//
// 提供:
//   - View: <HandPosePreviewView /> — カメラプレビュー + per-frame hand pose detection
//   - Event: onHandPose — view から detect 結果を emit
//   - Prop: paused — frame 配信の一時停止
//   - AsyncFunction: captureSnapshot — 直近 frame を JPEG 化して URI を返す (VLM 開始/終了判定用)
//   - AsyncFunction: startRecording / stopRecording — VideoDataOutput 経由で mp4 録画 (collection flow)
//
// 設計:
//   - HandPoseCameraController.shared が singleton。view が consumer を attach し、
//     module 関数は shared 経由で snapshot / recording を制御する。
//   - sandbox 検証フェーズなので、capture / streamRecord IF は持たない (sensor-session が役割)。

public class HandPoseModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HandPose")

    View(HandPosePreviewView.self) {
      Events("onHandPose")

      Prop("paused") { (view: HandPosePreviewView, paused: Bool) in
        view.setPaused(paused)
      }
    }

    AsyncFunction("captureSnapshot") { (promise: Promise) in
      Task.detached(priority: .userInitiated) {
        do {
          let url = try await HandPoseCameraController.shared.captureSnapshot()
          promise.resolve(url.absoluteString)
        } catch {
          promise.reject("HAND_POSE_SNAPSHOT_ERROR",
                         error.localizedDescription)
        }
      }
    }

    AsyncFunction("startRecording") { (outputPath: String, promise: Promise) in
      do {
        let url = try HandPoseCameraController.shared.startRecording(outputPath: outputPath)
        promise.resolve(url.absoluteString)
      } catch {
        promise.reject("HAND_POSE_RECORDING_START_ERROR",
                       error.localizedDescription)
      }
    }

    AsyncFunction("stopRecording") { (promise: Promise) in
      Task.detached(priority: .userInitiated) {
        do {
          let url = try await HandPoseCameraController.shared.stopRecording()
          promise.resolve(url.absoluteString)
        } catch {
          promise.reject("HAND_POSE_RECORDING_STOP_ERROR",
                         error.localizedDescription)
        }
      }
    }
  }
}

import ExpoModulesCore

// Hand pose ネイティブモジュール (iOS / Vision)。
//
// 提供:
//   - View: <HandPosePreviewView /> — カメラプレビュー + per-frame hand pose detection
//   - Event: onHandPose — view から detect 結果を emit
//   - Prop: paused — frame 配信の一時停止
//
// 設計:
//   - View に閉じ込め、Module 関数は最小限。frame stream は view が own。
//   - sandbox 検証フェーズなので、sensor-session のような capture / streamRecord IF は今は持たない。

public class HandPoseModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HandPose")

    View(HandPosePreviewView.self) {
      Events("onHandPose")

      Prop("paused") { (view: HandPosePreviewView, paused: Bool) in
        view.setPaused(paused)
      }
    }
  }
}

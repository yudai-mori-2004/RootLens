import Foundation
import Vision
import CoreVideo
import CoreImage

// AVCaptureSession の sample buffer を受け取り、 Vision HandPose (= 21 関節) を実行する。
//
// 2026-05-27: arkit-capture/HandTracker.swift から fork。 ARKit の personSegmentation 由来の
// segmentationCoverage / segmentationEdgeRatio は撤去 (= キャリブレーション baseline で代替する
// 新仕様のためフレーミング判定自体が不要)。 互換性のため Output 構造体には残し、 値は 0.0 固定。
//
// HandPose のレートは録画状態で変えられる:
//   - 録画前 = 15 Hz (= 開始ジェスチャを素早く反応)
//   - 録画中 = 5 Hz (= 終了ジェスチャは多少遅延しても問題ない)
//
// 呼び出しスレッド: WideCaptureController の captureQueue 上で順次。

final class HandTracker {

  /// 1 フレーム分の出力
  struct Output {
    let timestampNs: UInt64
    let imageWidth: Int
    let imageHeight: Int
    let classification: FrameClassification
    /// 互換性のため残置、 新仕様では常に 0.0
    let segmentationCoverage: Float
    /// 互換性のため残置、 新仕様では常に 0.0
    let segmentationEdgeRatio: Float
  }

  /// maximumHandCount は 2 に絞る (旧 hand-pose 実装と合わせる。 4 だと内部的に余分な探索が
  /// 走って detect が遅くなる + 誤検出も増えるトレードオフがある)。
  private let maximumHandCount: Int = 2

  init() {}

  /// 録画状態の引数は将来のため保持 (= 現状は何もしない)
  func setRecordingMode(_ isRecording: Bool) {
    _ = isRecording
  }

  /// 1 フレーム分の処理。 呼び出し側 (= WideCaptureController) が sample buffer 毎の throttle を
  /// 持つので、 ここでは追加の throttle はせず、 呼ばれる度に hand pose を実行する。
  func process(pixelBuffer: CVPixelBuffer,
               orientation: CGImagePropertyOrientation,
               timestampNs: UInt64) -> Output {

    let imageWidth = CVPixelBufferGetWidth(pixelBuffer)
    let imageHeight = CVPixelBufferGetHeight(pixelBuffer)

    let hands = runHandPose(pixelBuffer: pixelBuffer, orientation: orientation)

    // Wearer 分類 (= body pose 撤去のため、 単純に hand pose 結果を全部 wearer 扱い)
    let classification = WearerHandClassifier.classify(hands: hands, body: nil)

    return Output(
      timestampNs: timestampNs,
      imageWidth: imageWidth,
      imageHeight: imageHeight,
      classification: classification,
      segmentationCoverage: 0.0,
      segmentationEdgeRatio: 0.0
    )
  }

  // MARK: - Hand pose

  private func runHandPose(pixelBuffer: CVPixelBuffer, orientation: CGImagePropertyOrientation) -> [RawHand] {
    // 旧 hand-pose 実装と同じ pattern: 毎回新しい request + VNImageRequestHandler。
    let request = VNDetectHumanHandPoseRequest()
    request.maximumHandCount = maximumHandCount
    if VNDetectHumanHandPoseRequest.supportedRevisions.contains(VNDetectHumanHandPoseRequestRevision1) {
      request.revision = VNDetectHumanHandPoseRequestRevision1
    }
    let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: orientation, options: [:])
    do {
      try handler.perform([request])
    } catch {
      NSLog("[HandTracker] hand pose perform failed: %@", "\(error)")
      return []
    }
    return (request.results ?? []).compactMap(Self.convertHand)
  }

  private static func convertHand(_ obs: VNHumanHandPoseObservation) -> RawHand? {
    var landmarks: [HLandmark] = Array(repeating: HLandmark(x: 0, y: 0, confidence: 0), count: 21)

    let joints: [VNHumanHandPoseObservation.JointName: Int] = [
      .wrist:          HandJoint.wrist,
      .thumbCMC:       HandJoint.thumbCmc,
      .thumbMP:        HandJoint.thumbMcp,
      .thumbIP:        HandJoint.thumbIp,
      .thumbTip:       HandJoint.thumbTip,
      .indexMCP:       HandJoint.indexMcp,
      .indexPIP:       HandJoint.indexPip,
      .indexDIP:       HandJoint.indexDip,
      .indexTip:       HandJoint.indexTip,
      .middleMCP:      HandJoint.middleMcp,
      .middlePIP:      HandJoint.middlePip,
      .middleDIP:      HandJoint.middleDip,
      .middleTip:      HandJoint.middleTip,
      .ringMCP:        HandJoint.ringMcp,
      .ringPIP:        HandJoint.ringPip,
      .ringDIP:        HandJoint.ringDip,
      .ringTip:        HandJoint.ringTip,
      .littleMCP:      HandJoint.pinkyMcp,
      .littlePIP:      HandJoint.pinkyPip,
      .littleDIP:      HandJoint.pinkyDip,
      .littleTip:      HandJoint.pinkyTip,
    ]

    let allPoints: [VNHumanHandPoseObservation.JointName: VNRecognizedPoint]
    do {
      allPoints = try obs.recognizedPoints(.all)
    } catch {
      return nil
    }

    for (vKey, point) in allPoints {
      guard let idx = joints[vKey] else { continue }
      landmarks[idx] = HLandmark(
        x: Float(point.location.x),
        y: Float(1.0 - point.location.y),
        confidence: Float(point.confidence)
      )
    }

    let handednessStr: String
    switch obs.chirality {
    case .left:    handednessStr = "left"
    case .right:   handednessStr = "right"
    case .unknown: handednessStr = "unknown"
    @unknown default: handednessStr = "unknown"
    }

    return RawHand(handedness: handednessStr, confidence: Float(obs.confidence), landmarks: landmarks)
  }
}

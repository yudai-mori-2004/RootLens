import Foundation
import Vision
import CoreVideo
import CoreImage

// ARKit のフレームを受け取り、 以下を計算する:
//
//   1. ジェスチャ判定用: Vision HandPose (= 21 関節) を実行
//   2. フレーミング判定用: ARKit personSegmentation の buffer から
//      「人」 ピクセルの全体に対する割合と「画面端 (8% 余白外)」 にどれくらいあるかの統計
//
// 旧版にあった BodyPose は撤去 (= egocentric POV で torso が映らないと検出しないので fallback として
// 効かなかった + segmentation で代替できる)。
//
// HandPose のレートは録画状態で変えられる:
//   - 録画前 = 15 Hz (= start ジェスチャを素早く反応)
//   - 録画中 = 5 Hz (= stop ジェスチャは多少遅延しても問題ない)
//
// 呼び出しスレッド: ArSessionController の frameQueue 上で順次。

final class HandTracker {

  /// 1 フレーム分の出力
  struct Output {
    let timestampNs: UInt64
    let imageWidth: Int
    let imageHeight: Int
    let classification: FrameClassification
    /// 画面全体に占める 「人」 ピクセルの割合 (= 0..1)
    let segmentationCoverage: Float
    /// 「人」 ピクセルのうち、 画面の外周 frameSafeMargin に居る割合 (= 0..1)
    let segmentationEdgeRatio: Float
  }

  /// 「人ピクセルが画面端に居る」 と判定する余白割合 (= 上下左右からこの割合内側を「端」 とみなす)
  let frameSafeMargin: Float = 0.08

  /// maximumHandCount は 2 に絞る (旧 hand-pose 実装と合わせる。 4 だと内部的に余分な探索が
  /// 走って detect が遅くなる + 誤検出も増えるトレードオフがある)。
  private let maximumHandCount: Int = 2

  init() {}

  /// 録画状態の引数は将来のため保持 (= 現状は何もしない)
  func setRecordingMode(_ isRecording: Bool) {
    _ = isRecording
  }

  /// 1 フレーム分の処理。 呼び出し側 (= ArSessionController) が ARFrame 毎の throttle を持つので
  /// ここでは追加の throttle はせず、 呼ばれる度に hand pose を実行する。
  func process(pixelBuffer: CVPixelBuffer,
               segmentationBuffer: CVPixelBuffer?,
               orientation: CGImagePropertyOrientation,
               timestamp: TimeInterval,
               timestampNs: UInt64) -> Output {

    let imageWidth = CVPixelBufferGetWidth(pixelBuffer)
    let imageHeight = CVPixelBufferGetHeight(pixelBuffer)

    let hands = runHandPose(pixelBuffer: pixelBuffer, orientation: orientation)

    // Wearer 分類 (= body pose 撤去のため、 単純に hand pose 結果を全部 wearer 扱い)
    let classification = WearerHandClassifier.classify(hands: hands, body: nil)

    // Segmentation 統計 (= フレーミング状態の主信号)
    let (coverage, edgeRatio) = computeSegmentationStats(segmentationBuffer)

    _ = timestamp  // 引数未使用、 ABI 維持
    return Output(
      timestampNs: timestampNs,
      imageWidth: imageWidth,
      imageHeight: imageHeight,
      classification: classification,
      segmentationCoverage: coverage,
      segmentationEdgeRatio: edgeRatio
    )
  }

  // MARK: - Hand pose

  private func runHandPose(pixelBuffer: CVPixelBuffer, orientation: CGImagePropertyOrientation) -> [RawHand] {
    // 旧 hand-pose 実装と同じ pattern: 毎回新しい request + VNImageRequestHandler。
    // VNSequenceRequestHandler は理論的には連続フレームで安定するはずだが、 実機検証では
    // 単発 request + 単発 handler のほうが「検出されないゾーン」 にハマる頻度が低かった。
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

  // MARK: - Segmentation 統計

  /// personSegmentation buffer の各ピクセル値が >0 なら「人」 と扱う (= ARKit 規約)。
  /// 全ピクセル数に対する人ピクセルの割合と、 人ピクセルのうち外周マージン内に居る割合を返す。
  /// 引数 nil なら (0, 0)。
  ///
  /// ARKit の segmentation buffer は通常 192×256 程度の小さい解像度 (= 計算は速い、 stride 1 で OK)。
  private func computeSegmentationStats(_ buffer: CVPixelBuffer?) -> (coverage: Float, edgeRatio: Float) {
    guard let buf = buffer else { return (0, 0) }
    CVPixelBufferLockBaseAddress(buf, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(buf, .readOnly) }
    guard let base = CVPixelBufferGetBaseAddress(buf) else { return (0, 0) }

    let w = CVPixelBufferGetWidth(buf)
    let h = CVPixelBufferGetHeight(buf)
    let bytesPerRow = CVPixelBufferGetBytesPerRow(buf)
    let ptr = base.assumingMemoryBound(to: UInt8.self)

    let edgeXLo = Int(Float(w) * frameSafeMargin)
    let edgeXHi = w - edgeXLo
    let edgeYLo = Int(Float(h) * frameSafeMargin)
    let edgeYHi = h - edgeYLo

    var totalPersonPixels = 0
    var edgePersonPixels = 0
    // 解像度が低いので stride 1 で問題ない
    for y in 0..<h {
      let row = ptr.advanced(by: y * bytesPerRow)
      let inEdgeY = (y < edgeYLo) || (y >= edgeYHi)
      for x in 0..<w {
        if row[x] > 0 {
          totalPersonPixels += 1
          if inEdgeY || x < edgeXLo || x >= edgeXHi {
            edgePersonPixels += 1
          }
        }
      }
    }
    let totalPixels = w * h
    let coverage = totalPixels > 0 ? Float(totalPersonPixels) / Float(totalPixels) : 0
    let edgeRatio = totalPersonPixels > 0 ? Float(edgePersonPixels) / Float(totalPersonPixels) : 0
    return (coverage, edgeRatio)
  }
}

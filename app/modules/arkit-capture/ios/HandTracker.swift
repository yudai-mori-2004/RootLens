import Foundation
import Vision
import CoreVideo
import CoreImage

// Consumes ARKit frames and computes, per frame:
//
//   1. For gesture detection: Vision hand pose (21 joints per hand).
//   2. For framing feedback: statistics over ARKit's personSegmentation buffer,
//      i.e. what fraction of the frame is "person" pixels and how much of that
//      sits at the frame edge.
//
// Vision body pose is deliberately not used for wearer classification: from an
// egocentric point of view the torso is rarely in frame, so it fails exactly
// when it is needed; person segmentation covers the framing signal instead.
//
// Rate control (running hand pose at ~15 Hz before recording and lower during)
// is the caller's job; this class processes every frame it is handed.
//
// Threading: called sequentially on ArSessionController's frameQueue.

final class HandTracker {

  /// Output for one frame.
  struct Output {
    let timestampNs: UInt64
    let imageWidth: Int
    let imageHeight: Int
    let classification: FrameClassification
    /// Fraction of the whole frame covered by "person" pixels (0..1).
    let segmentationCoverage: Float
    /// Fraction of person pixels inside the outer frameSafeMargin band (0..1).
    let segmentationEdgeRatio: Float
  }

  /// Margin fraction that counts as "the frame edge" (this far inward from each side).
  let frameSafeMargin: Float = 0.08

  /// Capped at 2: allowing more makes Vision search longer per frame and
  /// increases false positives, with no benefit for a single wearer.
  private let maximumHandCount: Int = 2

  init() {}

  /// Hook for recording-state-dependent behavior; currently a no-op.
  func setRecordingMode(_ isRecording: Bool) {
    _ = isRecording
  }

  /// Process one frame. The caller (ArSessionController) throttles ARFrames, so
  /// no additional throttling happens here; hand pose runs on every call.
  func process(pixelBuffer: CVPixelBuffer,
               segmentationBuffer: CVPixelBuffer?,
               orientation: CGImagePropertyOrientation,
               timestamp: TimeInterval,
               timestampNs: UInt64) -> Output {

    let imageWidth = CVPixelBufferGetWidth(pixelBuffer)
    let imageHeight = CVPixelBufferGetHeight(pixelBuffer)

    let hands = runHandPose(pixelBuffer: pixelBuffer, orientation: orientation)

    // Wearer classification (with no body pose signal, every detected hand counts as the wearer's).
    let classification = WearerHandClassifier.classify(hands: hands, body: nil)

    // Segmentation statistics (the primary framing signal).
    let (coverage, edgeRatio) = computeSegmentationStats(segmentationBuffer)

    _ = timestamp  // unused; kept for call-site stability
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
    // A fresh request + VNImageRequestHandler every frame. VNSequenceRequestHandler
    // should in theory be more stable across consecutive frames, but on real
    // devices the one-shot pattern fell into "nothing detected" dead zones less often.
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

  // MARK: - Segmentation statistics

  /// A pixel value > 0 in the personSegmentation buffer means "person" (ARKit's
  /// convention). Returns the person fraction of all pixels and the fraction of
  /// person pixels inside the edge margin. nil input returns (0, 0).
  ///
  /// ARKit's segmentation buffer is small (typically ~192×256), so a full
  /// stride-1 scan is cheap.
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
    // Low resolution; stride 1 is fine.
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

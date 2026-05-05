import Foundation
import Vision
import CoreVideo
import CoreImage

// VNDetectHumanHandPoseRequest の薄ラッパー。
//
// Phase 2 ではフレーム毎に detect(pixelBuffer:) を呼び、Vision 標準 21 joint を返す。
// 内部状態を持たない (request は detect 毎に作る) ため、複数スレッドからの呼び出しは
// 各自が排他してください。HandPosePreviewView は専用 dispatch queue で逐次実行する。
//
// Vision Y 座標規約: 左下原点 (0,0) → 右上 (1,1)。
// JS-side schema と統一するため top-left origin に変換 (y' = 1 - y) してから返す。

final class HandPoseDetector {
  /// 同時検出する手の最大数 (両手対応のため 2)
  private let maximumHandCount: Int = 2

  /// 過去フレーム reuse のための request handler は使わない。
  /// VNImageRequestHandler は per-frame で再生成する (CVPixelBuffer 毎にオプションが変わるため)。

  func detect(pixelBuffer: CVPixelBuffer, orientation: CGImagePropertyOrientation) throws -> [HandObservation] {
    let request = VNDetectHumanHandPoseRequest()
    request.maximumHandCount = maximumHandCount
    // revision: Vision は OS 更新で精度が変わるため、明示的に最新を選ぶ
    if VNDetectHumanHandPoseRequest.supportedRevisions.contains(VNDetectHumanHandPoseRequestRevision1) {
      request.revision = VNDetectHumanHandPoseRequestRevision1
    }

    let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: orientation, options: [:])
    try handler.perform([request])

    guard let observations = request.results else { return [] }
    return try observations.map { try Self.convert($0) }
  }

  /// VNHumanHandPoseObservation を内部 HandObservation に変換する。
  /// - 21 個の joint を MediaPipe index 順で並べる
  /// - 取れなかった joint は confidence=0 / x=y=0 で埋める (UI 側で confidence 閾値で間引き可能)
  /// - Vision Y は左下原点なので top-left に flip
  private static func convert(_ obs: VNHumanHandPoseObservation) throws -> HandObservation {
    var landmarks = Array(repeating: HandLandmark(x: 0, y: 0, z: 0, confidence: 0), count: 21)

    // recognizedPoints(.all) で 21 全 joint を一括取得
    let allPoints: [VNHumanHandPoseObservation.JointName: VNRecognizedPoint]
    do {
      allPoints = try obs.recognizedPoints(.all)
    } catch {
      allPoints = [:]
    }

    for (joint, point) in allPoints {
      guard let index = HandPoseJointMap.visionToMediaPipeIndex[joint] else { continue }
      // Vision: 左下原点 (0,0) → 右上 (1,1)。top-left origin に flip。
      let xNorm = Float(point.location.x)
      let yNorm = Float(1.0 - point.location.y)
      let conf = Float(point.confidence)
      landmarks[index] = HandLandmark(x: xNorm, y: yNorm, z: 0, confidence: conf)
    }

    // handedness: Vision は chirality (.left/.right/.unknown) を返す
    let handedness: String
    switch obs.chirality {
    case .left: handedness = "left"
    case .right: handedness = "right"
    case .unknown: handedness = "unknown"
    @unknown default: handedness = "unknown"
    }

    return HandObservation(
      handedness: handedness,
      score: Float(obs.confidence),
      landmarks: landmarks
    )
  }
}

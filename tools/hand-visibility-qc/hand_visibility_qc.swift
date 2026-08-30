import AVFoundation
import CoreVideo
import Foundation
import ImageIO
import Vision

private struct Options {
  let input: URL
  let report: URL
  let details: URL
  let confidenceThreshold: Float
  let limit: Int?
  let skipFrames: Int
}

private struct FrameResult {
  let index: Int
  let timestampSeconds: Double
  let detectedHandCount: Int
  let maximumConfidence: Float
  let error: String?
}

private func usage() -> Never {
  FileHandle.standardError.write(Data("""
  Usage: swift hand_visibility_qc.swift <rgb.mp4> --report <report.json> --details <frames.jsonl> [--confidence 0.3] [--skip-frames N] [--limit N]

  Counts a frame as visible when Apple Vision detects at least one hand whose
  observation confidence is at or above the configured threshold.

  """.utf8))
  exit(2)
}

private func parseOptions() -> Options {
  let args = Array(CommandLine.arguments.dropFirst())
  guard let first = args.first, !first.hasPrefix("--") else { usage() }

  var report: String?
  var details: String?
  var confidence: Float = 0.3
  var limit: Int?
  var skipFrames = 0
  var index = 1
  while index < args.count {
    guard index + 1 < args.count else { usage() }
    let flag = args[index]
    let value = args[index + 1]
    switch flag {
    case "--report":
      report = value
    case "--details":
      details = value
    case "--confidence":
      guard let parsed = Float(value), parsed >= 0, parsed <= 1 else { usage() }
      confidence = parsed
    case "--limit":
      guard let parsed = Int(value), parsed > 0 else { usage() }
      limit = parsed
    case "--skip-frames":
      guard let parsed = Int(value), parsed >= 0 else { usage() }
      skipFrames = parsed
    default:
      usage()
    }
    index += 2
  }

  guard let report, let details else { usage() }
  return Options(
    input: URL(fileURLWithPath: first),
    report: URL(fileURLWithPath: report),
    details: URL(fileURLWithPath: details),
    confidenceThreshold: confidence,
    limit: limit,
    skipFrames: skipFrames)
}

private func writeStderr(_ value: String) {
  FileHandle.standardError.write(Data((value + "\n").utf8))
}

private func jsonLine(_ result: FrameResult) throws -> String {
  var row: [String: Any] = [
    "frame_index": result.index,
    "timestamp_seconds": result.timestampSeconds,
    "detected_hand_count": result.detectedHandCount,
    "maximum_observation_confidence": result.maximumConfidence,
    "hand_visible": result.detectedHandCount > 0,
  ]
  if let error = result.error {
    row["error"] = error
  }
  let data = try JSONSerialization.data(withJSONObject: row, options: [.sortedKeys])
  return String(decoding: data, as: UTF8.self) + "\n"
}

private let options = parseOptions()
private let fileManager = FileManager.default
try fileManager.createDirectory(
  at: options.report.deletingLastPathComponent(),
  withIntermediateDirectories: true)
try fileManager.createDirectory(
  at: options.details.deletingLastPathComponent(),
  withIntermediateDirectories: true)
guard fileManager.createFile(atPath: options.details.path, contents: nil) else {
  throw NSError(domain: "HandVisibilityQC", code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Could not create details output"])
}
let detailsHandle = try FileHandle(forWritingTo: options.details)
defer { try? detailsHandle.close() }

let asset = AVURLAsset(url: options.input)
guard let track = asset.tracks(withMediaType: .video).first else {
  throw NSError(domain: "HandVisibilityQC", code: 2,
                userInfo: [NSLocalizedDescriptionKey: "Input has no video track"])
}
let reader = try AVAssetReader(asset: asset)
let output = AVAssetReaderTrackOutput(
  track: track,
  outputSettings: [
    kCVPixelBufferPixelFormatTypeKey as String:
      Int(kCVPixelFormatType_420YpCbCr8BiPlanarFullRange),
  ])
output.alwaysCopiesSampleData = false
guard reader.canAdd(output) else {
  throw NSError(domain: "HandVisibilityQC", code: 3,
                userInfo: [NSLocalizedDescriptionKey: "AVAssetReader rejected video output"])
}
reader.add(output)
guard reader.startReading() else {
  throw reader.error ?? NSError(domain: "HandVisibilityQC", code: 4,
                                userInfo: [NSLocalizedDescriptionKey: "Reader did not start"])
}

let startedAt = Date()
var frameCount = 0
var decodedFrameCount = 0
var visibleFrameCount = 0
var zeroHandFrameCount = 0
var oneHandFrameCount = 0
var twoHandFrameCount = 0
var inferenceErrorCount = 0
var detailBuffer = ""

while let sample = output.copyNextSampleBuffer() {
  let sourceFrameIndex = decodedFrameCount
  decodedFrameCount += 1
  if sourceFrameIndex < options.skipFrames { continue }
  if let limit = options.limit, frameCount >= limit { break }
  let currentIndex = sourceFrameIndex
  frameCount += 1

  let timestampSeconds = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sample))
  let result: FrameResult = autoreleasepool {
    guard let pixelBuffer = CMSampleBufferGetImageBuffer(sample) else {
      return FrameResult(index: currentIndex, timestampSeconds: timestampSeconds,
                         detectedHandCount: 0, maximumConfidence: 0,
                         error: "missing_pixel_buffer")
    }

    let request = VNDetectHumanHandPoseRequest()
    request.maximumHandCount = 2
    if VNDetectHumanHandPoseRequest.supportedRevisions.contains(
      VNDetectHumanHandPoseRequestRevision1) {
      request.revision = VNDetectHumanHandPoseRequestRevision1
    }
    let handler = VNImageRequestHandler(
      cvPixelBuffer: pixelBuffer,
      orientation: .up,
      options: [:])
    do {
      try handler.perform([request])
      let observations = (request.results ?? []).filter {
        $0.confidence >= options.confidenceThreshold
      }
      return FrameResult(
        index: currentIndex,
        timestampSeconds: timestampSeconds,
        detectedHandCount: observations.count,
        maximumConfidence: observations.map(\.confidence).max() ?? 0,
        error: nil)
    } catch {
      return FrameResult(index: currentIndex, timestampSeconds: timestampSeconds,
                         detectedHandCount: 0, maximumConfidence: 0,
                         error: error.localizedDescription)
    }
  }

  switch result.detectedHandCount {
  case 0:
    zeroHandFrameCount += 1
  case 1:
    oneHandFrameCount += 1
    visibleFrameCount += 1
  default:
    twoHandFrameCount += 1
    visibleFrameCount += 1
  }
  if result.error != nil { inferenceErrorCount += 1 }
  detailBuffer += try jsonLine(result)
  if frameCount.isMultiple(of: 500) {
    detailsHandle.write(Data(detailBuffer.utf8))
    detailBuffer.removeAll(keepingCapacity: true)
    let elapsed = Date().timeIntervalSince(startedAt)
    let rate = elapsed > 0 ? Double(frameCount) / elapsed : 0
    let visibleRate = Double(visibleFrameCount) / Double(frameCount) * 100
    writeStderr(String(
      format: "frames=%d visible=%.2f%% processing=%.2f fps",
      frameCount, visibleRate, rate))
  }
}
if !detailBuffer.isEmpty {
  detailsHandle.write(Data(detailBuffer.utf8))
}

if reader.status == .failed {
  throw reader.error ?? NSError(domain: "HandVisibilityQC", code: 5,
                                userInfo: [NSLocalizedDescriptionKey: "Reader failed"])
}
guard frameCount > 0 else {
  throw NSError(domain: "HandVisibilityQC", code: 6,
                userInfo: [NSLocalizedDescriptionKey: "No frames were decoded"])
}

let elapsed = Date().timeIntervalSince(startedAt)
let visibleFraction = Double(visibleFrameCount) / Double(frameCount)
let report: [String: Any] = [
  "schema": "rootlens.hand-visibility-qc.v1",
  "input": options.input.path,
  "full_frame_scan": options.limit == nil && options.skipFrames == 0,
  "source_frame_start_index": options.skipFrames,
  "method": "Apple Vision VNDetectHumanHandPoseRequestRevision1",
  "criterion": "at least one hand observation at or above the confidence threshold",
  "maximum_hand_count": 2,
  "minimum_observation_confidence": options.confidenceThreshold,
  "frame_count": frameCount,
  "frames_with_hand": visibleFrameCount,
  "frames_without_hand": zeroHandFrameCount,
  "frames_with_one_hand": oneHandFrameCount,
  "frames_with_two_hands": twoHandFrameCount,
  "hand_visible_fraction": visibleFraction,
  "hand_visible_percent": visibleFraction * 100,
  "required_percent": 80.0,
  "passes_requirement": visibleFraction >= 0.8,
  "inference_error_count": inferenceErrorCount,
  "processing_seconds": elapsed,
  "processing_frames_per_second": Double(frameCount) / elapsed,
  "details_file": options.details.path,
]
let reportData = try JSONSerialization.data(
  withJSONObject: report,
  options: [.prettyPrinted, .sortedKeys])
try reportData.write(to: options.report, options: .atomic)
print(String(decoding: reportData, as: UTF8.self))

@preconcurrency import AVFoundation
@preconcurrency import CoreImage
@preconcurrency import CoreVideo
import Foundation
import Metal
@preconcurrency import Vision
import VideoToolbox

// Privacy blur pipeline: input mp4 → output mp4 (face-only)。
//
// Pipeline 概要:
//   1. AVAssetReader で input mp4 を BGRA pixel buffer として読み出す
//   2. preferredTransform を CIImage に焼き込んで「常に upright」表示状態にする
//      (writer 側で transform を持たせるアプローチを取らず、ピクセルにベイクする)
//   3. 各フレームで:
//      - Vision で顔矩形を検出 (毎フレーム、3-8ms)
//      - 顔矩形を白で描いた mask CIImage を構築
//      - 元画像に CIGaussianBlur をかけたものを mask で合成
//   4. AVAssetWriter (HEVC) に upright pixel buffer として書き出す
//
// テキスト blur は本ユニットでは未対応:
//   VNRecognizeTextRequest は recognizer であって detector ではないため、
//   PC 画面のような密集シーンで recall hole / 視点崩れ / 1 字 noise / 4-pass false
//   positive など制御不能な不安定性が出る。
//   2026 年時点で iOS 純正の text-region detector は存在せず、production 解は
//   DBNet / PP-OCRv5_det を CoreML 化する別ユニット (1.5-2 週間) になる。
//   本ユニットは顔のみでスコープを切り、text は後続タスクとして分離する。
//
// 検出時のダウンサンプル:
//   detectionScale = 0.66 で 1080p → ~720p 相当でデテクション → 計算量を約半分に。
//   ブラー合成は元解像度で行う (画質劣化なし)。

public struct PrivacyBlurOptions {
  public let inputUri: String
  public let outputUri: String?
  public let blurRadius: Double
  public let detectionScale: Double
  public let faceInflate: Double
}

public struct PrivacyBlurResult {
  public let outputUri: String
  public let durationMs: Int
  public let framesProcessed: Int
  public let facesBlurred: Int
  public let inputBytes: Int64
  public let outputBytes: Int64
  public let outputWidth: Int
  public let outputHeight: Int
  /// 実際にぼかした領域の per-frame 記録 (= C2PA blur assertion の元データ)。
  /// 顔が検出されたフレームのみ。 各要素: { "frame_index": Int, "regions": [{x,y,w,h}] }。
  /// 座標は upright フレームの top-left 原点・正規化 [0,1]。
  public let blurRegions: [[String: Any]]

  public func toDictionary() -> [String: Any] {
    return [
      "outputUri": outputUri,
      "durationMs": durationMs,
      "framesProcessed": framesProcessed,
      "facesBlurred": facesBlurred,
      "inputBytes": inputBytes,
      "outputBytes": outputBytes,
      "outputWidth": outputWidth,
      "outputHeight": outputHeight,
      "blurRegions": blurRegions,
    ]
  }
}

public typealias PrivacyBlurProgressCallback = (_ progress: Double, _ framesDone: Int, _ totalFrames: Int) -> Void

public enum PrivacyBlurError: Error, LocalizedError {
  case fileNotFound(String)
  case noVideoTrack
  case readerSetup(String)
  case writerSetup(String)
  case pixelBufferAlloc(String)
  case appendFailed(String)
  case readFailed(String)

  public var errorDescription: String? {
    switch self {
    case .fileNotFound(let p): return "Input file not found: \(p)"
    case .noVideoTrack: return "No video track in input asset"
    case .readerSetup(let m): return "AVAssetReader setup failed: \(m)"
    case .writerSetup(let m): return "AVAssetWriter setup failed: \(m)"
    case .pixelBufferAlloc(let m): return "CVPixelBuffer alloc failed: \(m)"
    case .appendFailed(let m): return "Append to writer failed: \(m)"
    case .readFailed(let m): return "Read from reader failed: \(m)"
    }
  }
}

public final class PrivacyBlurProcessor {
  private let opts: PrivacyBlurOptions
  private let ciContext: CIContext
  private let workingColorSpace: CGColorSpace

  // Detection state (single-instance fields, pipeline is single-thread per processor)
  private var totalFacesBlurred = 0
  private let faceTracker = FaceTracker()
  /// 実際にぼかした領域の per-frame 記録 (= C2PA blur assertion 用)。
  /// processFrame と同じ単一スレッド (requestMediaDataWhenReady の serial queue) で蓄積する。
  private var blurRegionsPerFrame: [[String: Any]] = []

  public static func process(
    _ opts: PrivacyBlurOptions,
    onProgress: PrivacyBlurProgressCallback? = nil
  ) async throws -> PrivacyBlurResult {
    let processor = PrivacyBlurProcessor(opts: opts)
    return try await processor.run(onProgress: onProgress)
  }

  private init(opts: PrivacyBlurOptions) {
    self.opts = opts
    self.workingColorSpace = CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()
    if let device = MTLCreateSystemDefaultDevice() {
      self.ciContext = CIContext(mtlDevice: device, options: [
        .workingColorSpace: workingColorSpace,
        .cacheIntermediates: false,
      ])
    } else {
      self.ciContext = CIContext(options: [.workingColorSpace: workingColorSpace])
    }
  }

  private func run(onProgress: PrivacyBlurProgressCallback?) async throws -> PrivacyBlurResult {
    let started = Date()

    // ---- resolve URLs ----
    let inputURL = try urlFromUri(opts.inputUri)
    guard FileManager.default.fileExists(atPath: inputURL.path) else {
      throw PrivacyBlurError.fileNotFound(inputURL.path)
    }
    let outputURL: URL = {
      if let s = opts.outputUri, !s.isEmpty {
        return (try? urlFromUri(s)) ?? defaultOutput(input: inputURL)
      }
      return defaultOutput(input: inputURL)
    }()
    try? FileManager.default.removeItem(at: outputURL)
    try FileManager.default.createDirectory(
      at: outputURL.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )

    // ---- input metadata (async loadValues) ----
    let asset = AVURLAsset(url: inputURL)
    let tracks = try await asset.loadTracks(withMediaType: .video)
    guard let track = tracks.first else { throw PrivacyBlurError.noVideoTrack }

    let naturalSize = try await track.load(.naturalSize)
    let preferredTransform = try await track.load(.preferredTransform)
    let nominalFrameRate = try await track.load(.nominalFrameRate)
    let duration = try await asset.load(.duration)

    // Display (upright) size — preferredTransform を bbox に適用して算出
    let naturalRect = CGRect(origin: .zero, size: naturalSize)
    let displayRect = naturalRect.applying(preferredTransform)
    let displaySize = CGSize(
      width: abs(displayRect.width).rounded(),
      height: abs(displayRect.height).rounded()
    )

    let totalFrames = max(1, Int(CMTimeGetSeconds(duration) * Double(max(1, nominalFrameRate))))

    // ---- Reader ----
    let reader = try AVAssetReader(asset: asset)
    let readerOutputSettings: [String: Any] = [
      kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
      kCVPixelBufferIOSurfacePropertiesKey as String: [:],
    ]
    let readerOutput = AVAssetReaderTrackOutput(track: track, outputSettings: readerOutputSettings)
    readerOutput.alwaysCopiesSampleData = false
    guard reader.canAdd(readerOutput) else {
      throw PrivacyBlurError.readerSetup("cannot add track output")
    }
    reader.add(readerOutput)

    // ---- Writer ----
    let writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
    let outW = Int(displaySize.width)
    let outH = Int(displaySize.height)
    // ピクセル/秒 × bits/pixel ≈ ~6 bps/pixel (1080p30 で約 12 Mbps)
    let bitrate = max(2_000_000, Int(displaySize.width * displaySize.height * 6.0))
    let videoSettings: [String: Any] = [
      AVVideoCodecKey: AVVideoCodecType.hevc,
      AVVideoWidthKey: outW,
      AVVideoHeightKey: outH,
      AVVideoCompressionPropertiesKey: [
        AVVideoAverageBitRateKey: bitrate,
        AVVideoProfileLevelKey: kVTProfileLevel_HEVC_Main_AutoLevel,
        AVVideoMaxKeyFrameIntervalKey: 60,
      ] as [String: Any]
    ]
    let writerInput = AVAssetWriterInput(mediaType: .video, outputSettings: videoSettings)
    writerInput.expectsMediaDataInRealTime = false
    // pixel は upright で書き出すので transform はかけない
    writerInput.transform = .identity

    let pixelBufferAttrs: [String: Any] = [
      kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
      kCVPixelBufferWidthKey as String: outW,
      kCVPixelBufferHeightKey as String: outH,
      kCVPixelBufferIOSurfacePropertiesKey as String: [:],
    ]
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(
      assetWriterInput: writerInput,
      sourcePixelBufferAttributes: pixelBufferAttrs
    )
    guard writer.canAdd(writerInput) else {
      throw PrivacyBlurError.writerSetup("cannot add writer input")
    }
    writer.add(writerInput)

    // ---- Start ----
    guard reader.startReading() else {
      throw PrivacyBlurError.readerSetup(reader.error?.localizedDescription ?? "startReading failed")
    }
    guard writer.startWriting() else {
      throw PrivacyBlurError.writerSetup(writer.error?.localizedDescription ?? "startWriting failed")
    }
    writer.startSession(atSourceTime: .zero)

    // ---- Pump frames ----
    var frameIndex = 0
    let processQueue = DispatchQueue(label: "rootlens.privacy-blur.process", qos: .userInitiated)

    try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
      // 二重 resume を防ぐ guard
      let resumed = AtomicFlag()
      writerInput.requestMediaDataWhenReady(on: processQueue) { [weak self] in
        guard let self = self else {
          if resumed.testAndSet() {
            cont.resume(throwing: PrivacyBlurError.readerSetup("processor deallocated"))
          }
          return
        }
        if resumed.isSet { return }

        while writerInput.isReadyForMoreMediaData {
          guard let sample = readerOutput.copyNextSampleBuffer() else {
            // Reader exhausted
            writerInput.markAsFinished()
            if reader.status == .completed {
              if resumed.testAndSet() { cont.resume(returning: ()) }
            } else {
              if resumed.testAndSet() {
                cont.resume(throwing: PrivacyBlurError.readFailed(
                  reader.error?.localizedDescription ?? "reader status=\(reader.status.rawValue)"
                ))
              }
            }
            return
          }

          guard let inputBuffer = CMSampleBufferGetImageBuffer(sample) else {
            // 1 frame skip (rare)
            continue
          }
          let pts = CMSampleBufferGetPresentationTimeStamp(sample)

          do {
            // autoreleasepool でフレームごとに CIImage / Vision request handler / output
            // PixelBuffer の retain を即解放させる。これを忘れると 1080p HEVC 1 分動画
            // (1800 frames × ~8MB BGRA buffer) でメモリが膨れて jetsam OOM kill される。
            let outBuffer: CVPixelBuffer = try autoreleasepool {
              try self.processFrame(
                inputBuffer: inputBuffer,
                preferredTransform: preferredTransform,
                displaySize: displaySize,
                frameIndex: frameIndex,
                pool: adaptor.pixelBufferPool
              )
            }
            if !adaptor.append(outBuffer, withPresentationTime: pts) {
              writerInput.markAsFinished()
              if resumed.testAndSet() {
                cont.resume(throwing: PrivacyBlurError.appendFailed(
                  writer.error?.localizedDescription ?? "append returned false"
                ))
              }
              return
            }
            frameIndex += 1

            if frameIndex % 10 == 0, let cb = onProgress {
              let progress = Double(frameIndex) / Double(totalFrames)
              cb(min(0.999, progress), frameIndex, totalFrames)
            }
          } catch {
            writerInput.markAsFinished()
            if resumed.testAndSet() { cont.resume(throwing: error) }
            return
          }
        }
      }
    }

    await writer.finishWriting()
    if writer.status != .completed {
      throw PrivacyBlurError.writerSetup(
        writer.error?.localizedDescription ?? "writer ended with status=\(writer.status.rawValue)"
      )
    }

    onProgress?(1.0, frameIndex, totalFrames)

    let inAttrs = try? FileManager.default.attributesOfItem(atPath: inputURL.path)
    let outAttrs = try? FileManager.default.attributesOfItem(atPath: outputURL.path)

    return PrivacyBlurResult(
      outputUri: "file://" + outputURL.path,
      durationMs: Int(Date().timeIntervalSince(started) * 1000),
      framesProcessed: frameIndex,
      facesBlurred: totalFacesBlurred,
      inputBytes: (inAttrs?[.size] as? NSNumber)?.int64Value ?? 0,
      outputBytes: (outAttrs?[.size] as? NSNumber)?.int64Value ?? 0,
      outputWidth: outW,
      outputHeight: outH,
      blurRegions: blurRegionsPerFrame
    )
  }

  // MARK: - Per-frame

  private func processFrame(
    inputBuffer: CVPixelBuffer,
    preferredTransform: CGAffineTransform,
    displaySize: CGSize,
    frameIndex: Int,
    pool: CVPixelBufferPool?
  ) throws -> CVPixelBuffer {
    // 1) input → CIImage (raw, sensor orientation)
    let raw = CIImage(cvPixelBuffer: inputBuffer)

    // 2) preferredTransform を焼き込んで upright に
    let transformed = raw.transformed(by: preferredTransform)
    // transform 後 extent は (-x, -y, w, h) のように負の origin になり得るので 0,0 に再アンカー
    let dx = -transformed.extent.minX
    let dy = -transformed.extent.minY
    let upright = transformed.transformed(by: .init(translationX: dx, y: dy))
    let uprightExtent = CGRect(origin: .zero, size: displaySize)

    // 3) 検出用のダウンサンプル画像
    let detectionImage: CIImage
    if opts.detectionScale < 0.999 {
      detectionImage = upright.transformed(by: .init(scaleX: opts.detectionScale, y: opts.detectionScale))
    } else {
      detectionImage = upright
    }

    // 4) 顔検出 (毎フレーム)
    var normalizedRegions: [CGRect] = []
    let faceRequest = VNDetectFaceRectanglesRequest()
    faceRequest.revision = VNDetectFaceRectanglesRequestRevision3
    let faceHandler = VNImageRequestHandler(
      ciImage: detectionImage,
      orientation: .up,
      options: [:]
    )
    var rawDetections: [CGRect] = []
    do {
      try faceHandler.perform([faceRequest])
      if let observations = faceRequest.results {
        for obs in observations {
          // VNFaceObservation の confidence は revision 3 でほぼ常に 1.0 に近い値が
          // 出るので閾値判定はあまり効かない。生 bbox をそのまま tracker に流す。
          let r = obs.boundingBox.intersection(CGRect(x: 0, y: 0, width: 1, height: 1))
          if !r.isNull && r.width > 0 && r.height > 0 {
            rawDetections.append(r)
          }
        }
      }
    } catch {
      // Vision face detection はまれに失敗する。ログだけ取って次へ。
      NSLog("[PrivacyBlur] face detect failed: \(error.localizedDescription)")
    }

    // 顔の bbox はフレーム間で微振動するため (sub-pixel jitter)、生のまま blur マスクに
    // すると境界がチラつく。FaceTracker で IoU マッチング + EMA 平滑化 + 検出途切れ時の
    // 最大 6 フレーム保持を行い、安定した bbox を出す。
    let smoothed = faceTracker.update(detections: rawDetections, frameIndex: frameIndex)
    for bbox in smoothed {
      let r = inflate(bbox, by: opts.faceInflate)
        .intersection(CGRect(x: 0, y: 0, width: 1, height: 1))
      if !r.isNull && r.width > 0 && r.height > 0 {
        normalizedRegions.append(r)
        totalFacesBlurred += 1
      }
    }

    // blur メタデータ: このフレームで実際にぼかした領域を記録 (= C2PA blur assertion の元データ)。
    // Vision/CIImage は bottom-left 原点。 メタデータは top-left 正規化 (= ML 標準) に変換し 4 桁丸め。
    if !normalizedRegions.isEmpty {
      let round4: (CGFloat) -> Double = { Double(($0 * 10000).rounded()) / 10000.0 }
      let regionDicts: [[String: Double]] = normalizedRegions.map { r in
        [
          "x": round4(r.minX),
          "y": round4(1.0 - (r.minY + r.height)),
          "w": round4(r.width),
          "h": round4(r.height),
        ]
      }
      blurRegionsPerFrame.append(["frame_index": frameIndex, "regions": regionDicts])
    }

    // 5) OCR は本ユニットでは未対応 (顔のみ)。詳細はファイル冒頭コメント参照。

    // 6) blur 領域がなければ upright をそのままレンダ
    if normalizedRegions.isEmpty {
      let outBuffer = try acquirePixelBuffer(pool: pool, width: Int(displaySize.width), height: Int(displaySize.height))
      ciContext.render(upright, to: outBuffer, bounds: uprightExtent, colorSpace: workingColorSpace)
      return outBuffer
    }

    // 7) Mask 構築 (display 解像度)
    let mask = buildMask(extent: uprightExtent, normalizedRects: normalizedRegions)

    // 8) Blur 全体に適用 (clamped で境界を伸ばし、最後に元 extent にクロップ)
    let blurred = upright
      .clampedToExtent()
      .applyingGaussianBlur(sigma: opts.blurRadius)
      .cropped(to: uprightExtent)

    // 9) Mask 合成: white 部 = blurred, black 部 = upright
    guard let blender = CIFilter(name: "CIBlendWithMask") else {
      throw PrivacyBlurError.writerSetup("CIBlendWithMask filter unavailable")
    }
    blender.setValue(blurred, forKey: "inputImage")
    blender.setValue(upright, forKey: "inputBackgroundImage")
    blender.setValue(mask, forKey: "inputMaskImage")
    guard let composite = blender.outputImage?.cropped(to: uprightExtent) else {
      throw PrivacyBlurError.writerSetup("blend output nil")
    }

    // 10) Output buffer に render
    let outBuffer = try acquirePixelBuffer(pool: pool, width: Int(displaySize.width), height: Int(displaySize.height))
    ciContext.render(composite, to: outBuffer, bounds: uprightExtent, colorSpace: workingColorSpace)
    return outBuffer
  }

  // MARK: - Helpers

  /// Vision の正規化 bbox (origin bottom-left, 0..1) を CIImage extent 座標に展開し、
  /// white で塗りつぶした mask を構築する。CIImage 座標系も bottom-left origin なので一致する。
  ///
  /// CRITICAL: white 矩形に `clampedToExtent()` をかけてはならない。clamp は extent 外の
  /// ピクセルを「最も近いエッジ色 (= 全部 white)」で埋め、Gaussian blur がそれを read して
  /// 結果が「無限の white」= mask 全画面 white = **画面全体が blur** される深刻なバグになる。
  /// blur は finite-extent の white に対してかけ、extent 外は alpha 0 (= mask=0=オリジナル)
  /// として扱われる。
  private func buildMask(extent: CGRect, normalizedRects: [CGRect]) -> CIImage {
    let black = CIImage(color: CIColor(red: 0, green: 0, blue: 0, alpha: 1)).cropped(to: extent)
    let softSigma = max(2.0, min(extent.width, extent.height) * 0.005)
    var mask = black
    for nr in normalizedRects {
      let pixelRect = CGRect(
        x: extent.minX + nr.minX * extent.width,
        y: extent.minY + nr.minY * extent.height,
        width: nr.width * extent.width,
        height: nr.height * extent.height
      )
      // 有限 extent の white 矩形。blur はこの extent 外を alpha 0 で扱うので、
      // 結果は「中心 white、エッジ soft fall-off」の領域限定 mask になる。
      let white = CIImage(color: CIColor(red: 1, green: 1, blue: 1, alpha: 1))
        .cropped(to: pixelRect)
        .applyingGaussianBlur(sigma: softSigma)
        .cropped(to: extent)
      mask = white.composited(over: mask)
    }
    return mask.cropped(to: extent)
  }

  private func inflate(_ r: CGRect, by frac: CGFloat) -> CGRect {
    let dx = r.width * frac
    let dy = r.height * frac
    return CGRect(
      x: r.minX - dx / 2,
      y: r.minY - dy / 2,
      width: r.width + dx,
      height: r.height + dy
    )
  }

  /// AVAssetWriterInputPixelBufferAdaptor の pool が利用できるならそこから 1 枚取得し、
  /// 無ければ最後の手段として CVPixelBufferCreate で fresh allocate。
  /// pool は内部で 3-5 枚に capped されており、フレームごとに recycle されるので
  /// 1080p HEVC 1 分撮影 (1800 frames × 8MB BGRA buffer) でも常駐は数十 MB に抑えられる。
  private func acquirePixelBuffer(pool: CVPixelBufferPool?, width: Int, height: Int) throws -> CVPixelBuffer {
    if let pool = pool {
      var buf: CVPixelBuffer?
      let status = CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, pool, &buf)
      if status == kCVReturnSuccess, let result = buf {
        return result
      }
      // pool drained 等は fresh allocate にフォールバック
      NSLog("[PrivacyBlur] pool createPixelBuffer status=%d, falling back to direct allocate", status)
    }
    let attrs: CFDictionary = [
      kCVPixelBufferPixelFormatTypeKey: kCVPixelFormatType_32BGRA,
      kCVPixelBufferIOSurfacePropertiesKey: [:],
      kCVPixelBufferWidthKey: width,
      kCVPixelBufferHeightKey: height,
    ] as CFDictionary
    var buf: CVPixelBuffer?
    let status = CVPixelBufferCreate(
      kCFAllocatorDefault,
      width, height,
      kCVPixelFormatType_32BGRA,
      attrs,
      &buf
    )
    guard status == kCVReturnSuccess, let result = buf else {
      throw PrivacyBlurError.pixelBufferAlloc("status=\(status)")
    }
    return result
  }

  private func defaultOutput(input: URL) -> URL {
    let dir = FileManager.default.temporaryDirectory
    let base = input.deletingPathExtension().lastPathComponent
    return dir.appendingPathComponent("\(base)_blurred_\(Int(Date().timeIntervalSince1970)).mp4")
  }

  private func urlFromUri(_ s: String) throws -> URL {
    if s.hasPrefix("file://") {
      return URL(fileURLWithPath: String(s.dropFirst(7)))
    }
    if s.hasPrefix("/") {
      return URL(fileURLWithPath: s)
    }
    if let u = URL(string: s) {
      return u
    }
    throw PrivacyBlurError.fileNotFound(s)
  }
}

// Per-frame の顔 bbox 振動を抑える temporal smoother。
//
// Vision face detect は同じ顔でも frame ごとに数 px / 数 % 程度 bbox が振れる。
// その bbox をそのまま blur マスクに使うと境界が「ちらちら」拡縮する。
//
// アルゴリズム:
//   1. 各フレームの新検出を、既存 track と IoU で best match を取る (>= matchIoU)
//   2. マッチした track には EMA 平滑化: bbox = (1-α)*old + α*new
//   3. マッチしない検出は新 track として追加
//   4. 検出が途切れた track は最大 maxHoldFrames フレームまで前回値で維持して安定化
//
// 30fps 動画で 0.4 alpha + 6 frame hold ≒ 200ms の慣性。これくらいが顔の早い動きに
// 追従しつつ jitter を消す sweet spot (経験則)。
private struct FaceTrack {
  var bbox: CGRect
  var lastSeenFrame: Int
  var ageFrames: Int
}

private final class FaceTracker {
  private var tracks: [FaceTrack] = []

  let smoothingAlpha: Double
  let matchIoU: Double
  let maxHoldFrames: Int

  init(smoothingAlpha: Double = 0.4, matchIoU: Double = 0.3, maxHoldFrames: Int = 6) {
    self.smoothingAlpha = smoothingAlpha
    self.matchIoU = matchIoU
    self.maxHoldFrames = maxHoldFrames
  }

  /// 新検出群を取り込み、現在 active な smoothed bbox の集合を返す。
  func update(detections: [CGRect], frameIndex: Int) -> [CGRect] {
    var matched = Array(repeating: false, count: tracks.count)

    // 1) 各検出に対して best-IoU の未マッチ track を探して merge
    for d in detections {
      var bestIdx = -1
      var bestIoU = matchIoU
      for (idx, track) in tracks.enumerated() {
        if matched[idx] { continue }
        let iou = computeIoU(d, track.bbox)
        if iou > bestIoU {
          bestIoU = iou
          bestIdx = idx
        }
      }
      if bestIdx >= 0 {
        matched[bestIdx] = true
        let prev = tracks[bestIdx].bbox
        tracks[bestIdx].bbox = lerp(prev, d, alpha: smoothingAlpha)
        tracks[bestIdx].lastSeenFrame = frameIndex
        tracks[bestIdx].ageFrames += 1
      } else {
        // 新規 track
        tracks.append(FaceTrack(bbox: d, lastSeenFrame: frameIndex, ageFrames: 1))
      }
    }

    // 2) 検出が途切れた既存 track は maxHoldFrames まで保持、それ以上で破棄
    tracks = tracks.filter { (frameIndex - $0.lastSeenFrame) <= maxHoldFrames }

    return tracks.map { $0.bbox }
  }

  func reset() { tracks.removeAll() }

  private func computeIoU(_ a: CGRect, _ b: CGRect) -> Double {
    let inter = a.intersection(b)
    if inter.isNull { return 0 }
    let interArea = Double(inter.width * inter.height)
    let unionArea = Double(a.width * a.height + b.width * b.height) - interArea
    if unionArea <= 0 { return 0 }
    return interArea / unionArea
  }

  private func lerp(_ a: CGRect, _ b: CGRect, alpha: Double) -> CGRect {
    let one = 1 - alpha
    return CGRect(
      x: a.minX * CGFloat(one) + b.minX * CGFloat(alpha),
      y: a.minY * CGFloat(one) + b.minY * CGFloat(alpha),
      width: a.width * CGFloat(one) + b.width * CGFloat(alpha),
      height: a.height * CGFloat(one) + b.height * CGFloat(alpha)
    )
  }
}

// 二重 resume を防ぐための簡単なフラグ。
final class AtomicFlag {
  private let lock = NSLock()
  private var flag = false
  var isSet: Bool {
    lock.lock(); defer { lock.unlock() }
    return flag
  }
  /// セットしたら true、既にセット済みなら false
  func testAndSet() -> Bool {
    lock.lock(); defer { lock.unlock() }
    if flag { return false }
    flag = true
    return true
  }
}

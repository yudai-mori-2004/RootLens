// macOS CLI 用に Expo Module 依存を外した PrivacyBlurProcessor。
// app/modules/privacy-blur/ios/PrivacyBlurProcessor.swift からロジックを流用。
// 単発の input mp4 → output mp4 (face blur) 変換に絞る。

@preconcurrency import AVFoundation
@preconcurrency import CoreImage
@preconcurrency import CoreVideo
import Foundation
import Metal
@preconcurrency import Vision
import VideoToolbox

public struct PrivacyBlurOptions {
    public let inputUri: String
    public let outputUri: String?
    public let blurRadius: Double
    public let detectionScale: Double
    public let faceInflate: Double

    public init(inputUri: String, outputUri: String? = nil, blurRadius: Double = 32, detectionScale: Double = 0.66, faceInflate: Double = 0.18) {
        self.inputUri = inputUri
        self.outputUri = outputUri
        self.blurRadius = blurRadius
        self.detectionScale = detectionScale
        self.faceInflate = faceInflate
    }
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

public final class PrivacyBlurProcessor: @unchecked Sendable {
    private let opts: PrivacyBlurOptions
    private let ciContext: CIContext
    private let workingColorSpace: CGColorSpace

    private var totalFacesBlurred = 0
    private var frameIndex = 0
    private let faceTracker = FaceTracker()

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

        let asset = AVURLAsset(url: inputURL)
        let tracks = try await asset.loadTracks(withMediaType: .video)
        guard let track = tracks.first else { throw PrivacyBlurError.noVideoTrack }

        let naturalSize = try await track.load(.naturalSize)
        let preferredTransform = try await track.load(.preferredTransform)
        let nominalFrameRate = try await track.load(.nominalFrameRate)
        let duration = try await asset.load(.duration)

        let naturalRect = CGRect(origin: .zero, size: naturalSize)
        let displayRect = naturalRect.applying(preferredTransform)
        let displaySize = CGSize(
            width: abs(displayRect.width).rounded(),
            height: abs(displayRect.height).rounded()
        )

        let totalFrames = max(1, Int(CMTimeGetSeconds(duration) * Double(max(1, nominalFrameRate))))

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

        let writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
        let outW = Int(displaySize.width)
        let outH = Int(displaySize.height)
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

        guard reader.startReading() else {
            throw PrivacyBlurError.readerSetup(reader.error?.localizedDescription ?? "startReading failed")
        }
        guard writer.startWriting() else {
            throw PrivacyBlurError.writerSetup(writer.error?.localizedDescription ?? "startWriting failed")
        }
        writer.startSession(atSourceTime: .zero)

        self.frameIndex = 0
        let processQueue = DispatchQueue(label: "rootlens.privacy-blur.process", qos: .userInitiated)

        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
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

                    guard let inputBuffer = CMSampleBufferGetImageBuffer(sample) else { continue }
                    let pts = CMSampleBufferGetPresentationTimeStamp(sample)

                    do {
                        let outBuffer: CVPixelBuffer = try autoreleasepool {
                            try self.processFrame(
                                inputBuffer: inputBuffer,
                                preferredTransform: preferredTransform,
                                displaySize: displaySize,
                                frameIndex: self.frameIndex,
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
                        self.frameIndex += 1
                        if self.frameIndex % 30 == 0, let cb = onProgress {
                            let progress = Double(self.frameIndex) / Double(totalFrames)
                            cb(min(0.999, progress), self.frameIndex, totalFrames)
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

        onProgress?(1.0, self.frameIndex, totalFrames)

        let inAttrs = try? FileManager.default.attributesOfItem(atPath: inputURL.path)
        let outAttrs = try? FileManager.default.attributesOfItem(atPath: outputURL.path)

        return PrivacyBlurResult(
            outputUri: "file://" + outputURL.path,
            durationMs: Int(Date().timeIntervalSince(started) * 1000),
            framesProcessed: self.frameIndex,
            facesBlurred: totalFacesBlurred,
            inputBytes: (inAttrs?[.size] as? NSNumber)?.int64Value ?? 0,
            outputBytes: (outAttrs?[.size] as? NSNumber)?.int64Value ?? 0,
            outputWidth: outW,
            outputHeight: outH
        )
    }

    private func processFrame(
        inputBuffer: CVPixelBuffer,
        preferredTransform: CGAffineTransform,
        displaySize: CGSize,
        frameIndex: Int,
        pool: CVPixelBufferPool?
    ) throws -> CVPixelBuffer {
        let raw = CIImage(cvPixelBuffer: inputBuffer)
        let transformed = raw.transformed(by: preferredTransform)
        let dx = -transformed.extent.minX
        let dy = -transformed.extent.minY
        let upright = transformed.transformed(by: .init(translationX: dx, y: dy))
        let uprightExtent = CGRect(origin: .zero, size: displaySize)

        let detectionImage: CIImage
        if opts.detectionScale < 0.999 {
            detectionImage = upright.transformed(by: .init(scaleX: opts.detectionScale, y: opts.detectionScale))
        } else {
            detectionImage = upright
        }

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
                    let r = obs.boundingBox.intersection(CGRect(x: 0, y: 0, width: 1, height: 1))
                    if !r.isNull && r.width > 0 && r.height > 0 {
                        rawDetections.append(r)
                    }
                }
            }
        } catch {
            // Vision face detection はまれに失敗する。 ログだけ取って次へ。
            FileHandle.standardError.write(Data("[macos-blur] face detect failed: \(error.localizedDescription)\n".utf8))
        }

        let smoothed = faceTracker.update(detections: rawDetections, frameIndex: frameIndex)
        for bbox in smoothed {
            let r = inflate(bbox, by: opts.faceInflate)
                .intersection(CGRect(x: 0, y: 0, width: 1, height: 1))
            if !r.isNull && r.width > 0 && r.height > 0 {
                normalizedRegions.append(r)
                totalFacesBlurred += 1
            }
        }

        if normalizedRegions.isEmpty {
            let outBuffer = try acquirePixelBuffer(pool: pool, width: Int(displaySize.width), height: Int(displaySize.height))
            ciContext.render(upright, to: outBuffer, bounds: uprightExtent, colorSpace: workingColorSpace)
            return outBuffer
        }

        let mask = buildMask(extent: uprightExtent, normalizedRects: normalizedRegions)
        let blurred = upright
            .clampedToExtent()
            .applyingGaussianBlur(sigma: opts.blurRadius)
            .cropped(to: uprightExtent)

        guard let blender = CIFilter(name: "CIBlendWithMask") else {
            throw PrivacyBlurError.writerSetup("CIBlendWithMask filter unavailable")
        }
        blender.setValue(blurred, forKey: "inputImage")
        blender.setValue(upright, forKey: "inputBackgroundImage")
        blender.setValue(mask, forKey: "inputMaskImage")
        guard let composite = blender.outputImage?.cropped(to: uprightExtent) else {
            throw PrivacyBlurError.writerSetup("blend output nil")
        }

        let outBuffer = try acquirePixelBuffer(pool: pool, width: Int(displaySize.width), height: Int(displaySize.height))
        ciContext.render(composite, to: outBuffer, bounds: uprightExtent, colorSpace: workingColorSpace)
        return outBuffer
    }

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

    private func acquirePixelBuffer(pool: CVPixelBufferPool?, width: Int, height: Int) throws -> CVPixelBuffer {
        if let pool = pool {
            var buf: CVPixelBuffer?
            let status = CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, pool, &buf)
            if status == kCVReturnSuccess, let result = buf {
                return result
            }
        }
        let attrs: CFDictionary = [
            kCVPixelBufferPixelFormatTypeKey: kCVPixelFormatType_32BGRA,
            kCVPixelBufferIOSurfacePropertiesKey: [:],
            kCVPixelBufferWidthKey: width,
            kCVPixelBufferHeightKey: height,
        ] as CFDictionary
        var buf: CVPixelBuffer?
        let status = CVPixelBufferCreate(
            kCFAllocatorDefault, width, height,
            kCVPixelFormatType_32BGRA, attrs, &buf
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

// ---- FaceTracker (= IoU マッチ + EMA 平滑化 + N frame hold) ----

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

    func update(detections: [CGRect], frameIndex: Int) -> [CGRect] {
        var matched = Array(repeating: false, count: tracks.count)
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
                tracks.append(FaceTrack(bbox: d, lastSeenFrame: frameIndex, ageFrames: 1))
            }
        }
        tracks = tracks.filter { (frameIndex - $0.lastSeenFrame) <= maxHoldFrames }
        return tracks.map { $0.bbox }
    }

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

final class AtomicFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var flag = false
    var isSet: Bool {
        lock.lock(); defer { lock.unlock() }
        return flag
    }
    func testAndSet() -> Bool {
        lock.lock(); defer { lock.unlock() }
        if flag { return false }
        flag = true
        return true
    }
}

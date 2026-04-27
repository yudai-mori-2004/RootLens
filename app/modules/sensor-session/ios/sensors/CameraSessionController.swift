import AVFoundation
import Foundation

// AVCaptureSession を Process 内で 1 個だけ持つ singleton。
// CameraSensor が capture に使い、PreviewView がプレビュー描画に attach する。
//
// 設計思想 (Plan C):
//   - expo-camera は撤去 (session 競合を避ける)
//   - 全 AVCaptureSession 系 (Camera / Depth / ARKit Camera) は exclusivityGroup="ios.av_session" で
//     ここに集約。Phase 2 では CameraSensor のみ。Task 04 で Depth が同 controller に乗る。
//
// API レスポンスをそのまま記録 (Don't be the judge):
//   - capture 結果の payload は AVCapturePhoto / AVCaptureDevice / AVCaptureDeviceFormat の
//     プロパティをそのまま JSON 化したもののみ。RootLens 独自分類は持たない。

final class CameraSessionController {
  static let shared = CameraSessionController()

  let session = AVCaptureSession()
  private let configQueue = DispatchQueue(label: "io.rootlens.sensor-session.camera-config")

  private var activeDevice: AVCaptureDevice?
  private var activeInput: AVCaptureDeviceInput?
  private let photoOutput = AVCapturePhotoOutput()
  private var configured = false

  // Task 04: AVCaptureDepth 対応。photoOutput 自身が depth data delivery を持つので
  // 別 output は要らない。capturePhoto 時に AVCapturePhotoSettings.isDepthDataDeliveryEnabled = true で
  // AVCapturePhoto.depthData を取れる。HEIF photo の auxC として埋め込む経路もある。
  private(set) var supportsDepthDataDelivery: Bool = false

  private init() {}

  // MARK: - Configuration / Lifecycle

  /// Idempotent。最初に呼ばれたタイミングで session 構成し、以降は何もしない。
  /// Camera 切替 (Task 05) では reconfigure(...) を別途用意する。
  func configureIfNeeded() throws {
    var capturedError: Error?
    configQueue.sync {
      if self.configured { return }
      do {
        try self.configureLocked()
        self.configured = true
      } catch {
        capturedError = error
      }
    }
    if let e = capturedError { throw e }
  }

  private func configureLocked() throws {
    session.beginConfiguration()
    defer { session.commitConfiguration() }

    session.sessionPreset = .photo

    // 既定の背面カメラ。Task 05 で UX 経由の切替に拡張。
    guard let device = Self.defaultBackCamera() else {
      throw CameraSessionError.deviceUnavailable("no back camera")
    }
    let input = try AVCaptureDeviceInput(device: device)
    if session.canAddInput(input) {
      session.addInput(input)
      activeInput = input
      activeDevice = device
    } else {
      throw CameraSessionError.configurationFailure("cannot add camera input")
    }

    if session.canAddOutput(photoOutput) {
      session.addOutput(photoOutput)
    } else {
      throw CameraSessionError.configurationFailure("cannot add photo output")
    }
    photoOutput.isHighResolutionCaptureEnabled = true

    // Task 04: depth data delivery 有効化 (LiDAR / TrueDepth / Dual/Triple カメラで利用可)
    if photoOutput.isDepthDataDeliverySupported {
      photoOutput.isDepthDataDeliveryEnabled = true
      supportsDepthDataDelivery = true
    } else {
      supportsDepthDataDelivery = false
    }
  }

  func startIfNeeded() {
    configQueue.async {
      if !self.session.isRunning {
        self.session.startRunning()
      }
    }
  }

  func stopIfNeeded() {
    configQueue.async {
      if self.session.isRunning {
        self.session.stopRunning()
      }
    }
  }

  // MARK: - Descriptor

  /// CameraSensor.descriptor() に渡す capability 情報。
  /// AVCaptureDevice の取得可能なメタを raw でそのまま返す。
  func currentDeviceDescriptor() -> [String: Any] {
    guard let device = activeDevice else {
      return [
        "configured": configured,
        "device": NSNull()
      ]
    }
    var info: [String: Any] = [
      "configured": configured,
      "unique_id": device.uniqueID,
      "model_id": device.modelID,
      "localized_name": device.localizedName,
      "device_type": device.deviceType.rawValue,
      "position": Self.positionString(device.position),
      "manufacturer": device.manufacturer,
      "lens_aperture": device.lensAperture,
      "is_running": session.isRunning,
    ]
    if #available(iOS 13.0, *) {
      info["minimum_focus_distance"] = device.minimumFocusDistance
    }
    let format = device.activeFormat
    info["active_format"] = [
      "format_description": String(describing: format.formatDescription),
      "media_type": format.mediaType.rawValue,
      "supported_depth_data_formats_count": format.supportedDepthDataFormats.count,
      "video_field_of_view": format.videoFieldOfView,
      "video_max_zoom_factor": format.videoMaxZoomFactor,
    ]
    return info
  }

  // MARK: - Photo / Depth Bundle Capture (Task 04)

  // anchor key で 1 トリガー結果を共有 (CameraSensor + AvCaptureDepthDataSensor が同 anchor で呼ぶ)
  private let bundleLock = NSLock()
  private var bundleAnchorKey: UInt64 = 0
  private var bundleResult: CapturedBundle?

  /// JPEG + (利用可能なら) AVDepthData を 1 トリガーで取得。
  /// 同 anchorKey で複数回呼ばれた場合、先頭の結果を共有する。
  func captureBundle(anchorKey: UInt64) async throws -> CapturedBundle {
    bundleLock.lock()
    if let cached = bundleResult, bundleAnchorKey == anchorKey {
      bundleLock.unlock()
      return cached
    }
    bundleLock.unlock()

    let bundle = try await doCaptureBundle()
    bundleLock.lock()
    bundleAnchorKey = anchorKey
    bundleResult = bundle
    bundleLock.unlock()
    return bundle
  }

  /// 後方互換: jpeg だけ欲しい呼び出し用 (anchor 自前生成、bundle は使い捨て)
  func capturePhoto() async throws -> CapturedPhoto {
    try await captureBundle(anchorKey: monotonicNanoseconds()).photo
  }

  private func doCaptureBundle() async throws -> CapturedBundle {
    try configureIfNeeded()
    startIfNeeded()
    return try await withCheckedThrowingContinuation { continuation in
      let settings = makePhotoSettings()
      let captureNs = monotonicNanoseconds()
      let delegate = PhotoCaptureDelegate(captureNs: captureNs) { result in
        switch result {
        case .success(let bundle):
          continuation.resume(returning: bundle)
        case .failure(let err):
          continuation.resume(throwing: err)
        }
      }
      Self.activeDelegates.append(delegate)
      photoOutput.capturePhoto(with: settings, delegate: delegate)
    }
  }

  // delegate を session 中保持するための簡易プール。capture 完了で個別に release される
  private static var activeDelegates: [PhotoCaptureDelegate] = []

  static func releaseDelegate(_ d: PhotoCaptureDelegate) {
    activeDelegates.removeAll { $0 === d }
  }

  private func makePhotoSettings() -> AVCapturePhotoSettings {
    // v0.1.1 は JPEG 固定。HEIC は v0.1.2 以降 (検証ツール対応の都合)。
    let settings = AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.jpeg])
    // depth data delivery (Task 04)。HEIF auxC ではなく、AVCapturePhoto.depthData として取り出して
    // AvCaptureDepthDataSensor が C2PA assertion に raw bytes として埋める経路を使う。
    if photoOutput.isDepthDataDeliveryEnabled {
      settings.isDepthDataDeliveryEnabled = true
      settings.embedsDepthDataInPhoto = false  // 内部メタへの埋込みは off (assertion 経路で扱う)
    }
    return settings
  }

  // MARK: - Helpers

  private static func defaultBackCamera() -> AVCaptureDevice? {
    if let triple = AVCaptureDevice.default(.builtInTripleCamera, for: .video, position: .back) {
      return triple
    }
    if let dual = AVCaptureDevice.default(.builtInDualCamera, for: .video, position: .back) {
      return dual
    }
    return AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
  }

  private static func positionString(_ p: AVCaptureDevice.Position) -> String {
    switch p {
    case .back: return "back"
    case .front: return "front"
    case .unspecified: return "unspecified"
    @unknown default: return "unknown"
    }
  }
}

// MARK: - Types

enum CameraSessionError: LocalizedError {
  case deviceUnavailable(String)
  case configurationFailure(String)
  case captureFailure(String)

  var errorDescription: String? {
    switch self {
    case .deviceUnavailable(let s): return "camera device unavailable: \(s)"
    case .configurationFailure(let s): return "camera configuration failure: \(s)"
    case .captureFailure(let s): return "camera capture failure: \(s)"
    }
  }
}

struct CapturedPhoto {
  let outputPath: String
  let captureNs: UInt64
  let endNs: UInt64
  let metadata: [String: Any]
  let resolvedSettings: [String: Any]
  let deviceInfo: [String: Any]
}

/// AVDepthData の取得結果。AvCaptureDepthDataSensor が読む。
struct CapturedDepth {
  let depthDataType: UInt32                 // CVPixelFormat (DepthFloat32 / DisparityFloat32 等)
  let depthDataTypeName: String             // "DepthFloat32" / "DisparityFloat32" / "DepthFloat16" / "DisparityFloat16"
  let width: Int
  let height: Int
  let rawBytes: Data                        // pixel buffer の生バイト
  let bytesPerRow: Int
  let isDepthDataFiltered: Bool
  let depthDataAccuracy: String             // "relative" / "absolute"
  let depthDataQuality: String              // "low" / "high"
  let cameraCalibration: [String: Any]      // intrinsics / extrinsics / distortion
  let captureNs: UInt64
  let endNs: UInt64
}

struct CapturedBundle {
  let photo: CapturedPhoto
  let depth: CapturedDepth?
}

// MARK: - Delegate

final class PhotoCaptureDelegate: NSObject, AVCapturePhotoCaptureDelegate {
  private let captureNs: UInt64
  private let onFinish: (Result<CapturedBundle, Error>) -> Void
  private var resolvedSettings: AVCaptureResolvedPhotoSettings?

  init(captureNs: UInt64, onFinish: @escaping (Result<CapturedBundle, Error>) -> Void) {
    self.captureNs = captureNs
    self.onFinish = onFinish
  }

  func photoOutput(_ output: AVCapturePhotoOutput,
                   didFinishProcessingPhoto photo: AVCapturePhoto,
                   error: Error?) {
    defer { CameraSessionController.releaseDelegate(self) }
    if let e = error {
      onFinish(.failure(e))
      return
    }
    guard let data = photo.fileDataRepresentation() else {
      onFinish(.failure(CameraSessionError.captureFailure("no file data representation")))
      return
    }

    let dir = NSTemporaryDirectory()
    let outputPath = "\(dir)rootlens_capture_\(captureNs).jpg"
    do {
      try data.write(to: URL(fileURLWithPath: outputPath))
    } catch {
      onFinish(.failure(error))
      return
    }

    let endNs = monotonicNanoseconds()
    let metadata = sanitizeForJson(photo.metadata) as? [String: Any] ?? [:]

    let resolved: [String: Any] = [
      "photo_dimensions": [
        "width": Int(photo.resolvedSettings.photoDimensions.width),
        "height": Int(photo.resolvedSettings.photoDimensions.height)
      ]
    ]

    let deviceInfo = CameraSessionController.shared.currentDeviceDescriptor()

    let capturedPhoto = CapturedPhoto(
      outputPath: outputPath,
      captureNs: captureNs,
      endNs: endNs,
      metadata: metadata,
      resolvedSettings: resolved,
      deviceInfo: deviceInfo
    )

    // Task 04: AVCapturePhoto.depthData を取り出して CapturedDepth として返す。
    // photoOutput.isDepthDataDeliveryEnabled = true で settings.isDepthDataDeliveryEnabled = true
    // のときに非 null になる。
    let depth = Self.extractDepth(from: photo, captureNs: captureNs, endNs: endNs)

    onFinish(.success(CapturedBundle(photo: capturedPhoto, depth: depth)))
  }

  private static func extractDepth(from photo: AVCapturePhoto, captureNs: UInt64, endNs: UInt64) -> CapturedDepth? {
    guard let depthData = photo.depthData else { return nil }
    let buffer = depthData.depthDataMap
    let width = CVPixelBufferGetWidth(buffer)
    let height = CVPixelBufferGetHeight(buffer)
    let bytesPerRow = CVPixelBufferGetBytesPerRow(buffer)
    let pixelType = CVPixelBufferGetPixelFormatType(buffer)

    CVPixelBufferLockBaseAddress(buffer, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
    guard let base = CVPixelBufferGetBaseAddress(buffer) else { return nil }
    let totalBytes = bytesPerRow * height
    let raw = Data(bytes: base, count: totalBytes)

    let typeName: String
    switch pixelType {
    case kCVPixelFormatType_DepthFloat32: typeName = "DepthFloat32"
    case kCVPixelFormatType_DepthFloat16: typeName = "DepthFloat16"
    case kCVPixelFormatType_DisparityFloat32: typeName = "DisparityFloat32"
    case kCVPixelFormatType_DisparityFloat16: typeName = "DisparityFloat16"
    default: typeName = "Unknown(\(pixelType))"
    }

    let accuracy: String
    switch depthData.depthDataAccuracy {
    case .relative: accuracy = "relative"
    case .absolute: accuracy = "absolute"
    @unknown default: accuracy = "unknown"
    }
    let quality: String
    switch depthData.depthDataQuality {
    case .low: quality = "low"
    case .high: quality = "high"
    @unknown default: quality = "unknown"
    }

    var calibration: [String: Any] = [:]
    if let calib = depthData.cameraCalibrationData {
      calibration["pixel_size"] = calib.pixelSize
      calibration["intrinsic_matrix"] = [
        [calib.intrinsicMatrix.columns.0.x, calib.intrinsicMatrix.columns.0.y, calib.intrinsicMatrix.columns.0.z],
        [calib.intrinsicMatrix.columns.1.x, calib.intrinsicMatrix.columns.1.y, calib.intrinsicMatrix.columns.1.z],
        [calib.intrinsicMatrix.columns.2.x, calib.intrinsicMatrix.columns.2.y, calib.intrinsicMatrix.columns.2.z]
      ]
      calibration["intrinsic_matrix_reference_dimensions"] = [
        "width": Float(calib.intrinsicMatrixReferenceDimensions.width),
        "height": Float(calib.intrinsicMatrixReferenceDimensions.height)
      ]
      calibration["lens_distortion_center"] = [
        "x": Float(calib.lensDistortionCenter.x),
        "y": Float(calib.lensDistortionCenter.y)
      ]
      calibration["extrinsic_matrix"] = [
        [calib.extrinsicMatrix.columns.0.x, calib.extrinsicMatrix.columns.0.y, calib.extrinsicMatrix.columns.0.z],
        [calib.extrinsicMatrix.columns.1.x, calib.extrinsicMatrix.columns.1.y, calib.extrinsicMatrix.columns.1.z],
        [calib.extrinsicMatrix.columns.2.x, calib.extrinsicMatrix.columns.2.y, calib.extrinsicMatrix.columns.2.z],
        [calib.extrinsicMatrix.columns.3.x, calib.extrinsicMatrix.columns.3.y, calib.extrinsicMatrix.columns.3.z]
      ]
    }

    return CapturedDepth(
      depthDataType: pixelType,
      depthDataTypeName: typeName,
      width: width,
      height: height,
      rawBytes: raw,
      bytesPerRow: bytesPerRow,
      isDepthDataFiltered: depthData.isDepthDataFiltered,
      depthDataAccuracy: accuracy,
      depthDataQuality: quality,
      cameraCalibration: calibration,
      captureNs: captureNs,
      endNs: endNs
    )
  }
}

// MARK: - Helpers

/// JSON-serializable な値のみを取り出す再帰サニタイズ。Data/CFData 等は除外する。
func sanitizeForJson(_ value: Any) -> Any {
  if let dict = value as? [String: Any] {
    var out: [String: Any] = [:]
    for (k, v) in dict {
      out[k] = sanitizeForJson(v)
    }
    return out
  }
  if let arr = value as? [Any] {
    return arr.map { sanitizeForJson($0) }
  }
  if value is String || value is NSNumber || value is Bool {
    return value
  }
  if let n = value as? NSNumber {
    return n
  }
  if value is NSNull {
    return value
  }
  // Data, CFData, etc. は文字列化
  return String(describing: value)
}

/// CMLogItem.timestamp / ProcessInfo.systemUptime と同じ時間軸の monotonic ns。
/// AVCaptureSession の CMSampleBuffer PTS とも整合する。
/// (mach_absolute_time ベース。デバイスが sleep していない前提)
func monotonicNanoseconds() -> UInt64 {
  var info = mach_timebase_info_data_t()
  mach_timebase_info(&info)
  let t = mach_absolute_time()
  return UInt64(Double(t) * Double(info.numer) / Double(info.denom))
}

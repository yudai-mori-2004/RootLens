import Accelerate
import CoreGraphics
import CoreVideo
import Foundation
import ImageIO

// Pure pixel-buffer → PNG encoders for the recorded sensor data. Stateless.
//
// Fidelity notes (this data is used for research; every transform is listed):
//   - Depth: float32 meters → uint16 millimeters is the only lossy step
//     (1 mm quantization; NaN → 0, where 0 is the conventional RGB-D sentinel
//     for "no data"; clamped at 65.535 m, far beyond LiDAR range). PNG itself
//     is lossless.
//   - Confidence: byte-for-byte pass-through into a lossless 8-bit gray PNG.

enum PixelEncoders {

  /// Encode a CVPixelBuffer (ARKit sceneDepth, kCVPixelFormatType_DepthFloat32)
  /// as a 16-bit gray PNG (float32 meters → uint16 millimeters), the standard
  /// RGB-D dataset format.
  static func depthMapToPngData(_ depthMap: CVPixelBuffer) -> Data? {
    CVPixelBufferLockBaseAddress(depthMap, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(depthMap, .readOnly) }

    let width = CVPixelBufferGetWidth(depthMap)
    let height = CVPixelBufferGetHeight(depthMap)
    let bytesPerRow = CVPixelBufferGetBytesPerRow(depthMap)
    guard let base = CVPixelBufferGetBaseAddress(depthMap) else { return nil }

    let floatStride = bytesPerRow / MemoryLayout<Float32>.size
    let floatPtr = base.assumingMemoryBound(to: Float32.self)
    let pixelCount = width * height

    // float32 (meters) → uint16 (millimeters), vectorized:
    // vsmul ×1000 → non-finite scrub → vclip [0, 65535] → vfixu16 (truncate).
    // The scrub stays scalar because vclip/vfixu16 leave NaN behavior undefined;
    // 0 is the conventional RGB-D "no data" sentinel and must be deterministic.
    var scratch = [Float](repeating: 0, count: pixelCount)
    var scale: Float = 1000.0
    scratch.withUnsafeMutableBufferPointer { dst in
      guard let dstBase = dst.baseAddress else { return }
      if floatStride == width {
        vDSP_vsmul(floatPtr, 1, &scale, dstBase, 1, vDSP_Length(pixelCount))
      } else {
        for y in 0..<height {
          vDSP_vsmul(floatPtr + y * floatStride, 1, &scale,
                     dstBase + y * width, 1, vDSP_Length(width))
        }
      }
      for i in 0..<pixelCount where !dstBase[i].isFinite {
        dstBase[i] = dstBase[i] > 0 ? 65535.0 : 0.0
      }
    }
    var lo: Float = 0.0
    var hi: Float = 65535.0
    vDSP_vclip(scratch, 1, &lo, &hi, &scratch, 1, vDSP_Length(pixelCount))
    var u16 = [UInt16](repeating: 0, count: pixelCount)
    u16.withUnsafeMutableBufferPointer { dst in
      guard let dstBase = dst.baseAddress else { return }
      vDSP_vfixu16(scratch, 1, dstBase, 1, vDSP_Length(pixelCount))
    }

    let cs = CGColorSpaceCreateDeviceGray()
    let bitmapInfo = CGBitmapInfo(rawValue: CGImageAlphaInfo.none.rawValue | CGBitmapInfo.byteOrder16Little.rawValue)
    let data = NSData(bytes: u16, length: u16.count * 2)
    guard let provider = CGDataProvider(data: data as CFData) else { return nil }
    guard let cgImage = CGImage(
      width: width, height: height,
      bitsPerComponent: 16, bitsPerPixel: 16,
      bytesPerRow: width * 2,
      space: cs, bitmapInfo: bitmapInfo,
      provider: provider,
      decode: nil, shouldInterpolate: false,
      intent: .defaultIntent
    ) else { return nil }

    let out = NSMutableData()
    guard let dest = CGImageDestinationCreateWithData(out as CFMutableData, "public.png" as CFString, 1, nil) else { return nil }
    CGImageDestinationAddImage(dest, cgImage, nil)
    guard CGImageDestinationFinalize(dest) else { return nil }
    return out as Data
  }

  /// Encode a CVPixelBuffer (ARKit sceneDepth.confidenceMap,
  /// kCVPixelFormatType_OneComponent8; values 0=low / 1=medium / 2=high) as an
  /// 8-bit gray PNG.
  static func confidenceMapToPngData(_ conf: CVPixelBuffer) -> Data? {
    CVPixelBufferLockBaseAddress(conf, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(conf, .readOnly) }

    let width = CVPixelBufferGetWidth(conf)
    let height = CVPixelBufferGetHeight(conf)
    let bytesPerRow = CVPixelBufferGetBytesPerRow(conf)
    guard let base = CVPixelBufferGetBaseAddress(conf) else { return nil }

    var u8 = [UInt8](repeating: 0, count: width * height)
    for y in 0..<height {
      let src = base.advanced(by: y * bytesPerRow).assumingMemoryBound(to: UInt8.self)
      for x in 0..<width {
        u8[y * width + x] = src[x]
      }
    }

    let cs = CGColorSpaceCreateDeviceGray()
    let data = NSData(bytes: u8, length: u8.count)
    guard let provider = CGDataProvider(data: data as CFData) else { return nil }
    guard let cgImage = CGImage(
      width: width, height: height,
      bitsPerComponent: 8, bitsPerPixel: 8,
      bytesPerRow: width,
      space: cs, bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.none.rawValue),
      provider: provider,
      decode: nil, shouldInterpolate: false,
      intent: .defaultIntent
    ) else { return nil }

    let out = NSMutableData()
    guard let dest = CGImageDestinationCreateWithData(out as CFMutableData, "public.png" as CFString, 1, nil) else { return nil }
    CGImageDestinationAddImage(dest, cgImage, nil)
    guard CGImageDestinationFinalize(dest) else { return nil }
    return out as Data
  }
}

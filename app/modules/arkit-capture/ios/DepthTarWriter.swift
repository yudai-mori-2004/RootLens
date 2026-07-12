import CoreVideo
import Foundation

// Streams LiDAR depth frames into a single depth.tar during recording.
//
// Each frame becomes a standard 16-bit PNG (millimeters) at
// depth/<frameIndex:06>.png; the same frame's confidence map (ARKit
// sceneDepth.confidenceMap: 0=low / 1=medium / 2=high) sits beside it as
// confidence/<frameIndex:06>.png (8-bit). One tar uploads in place of tens of
// thousands of loose PNGs, and extracting it yields the conventional RGB-D
// depth/ layout.
//
// The tar file is lazily created on the first append, so non-LiDAR devices
// (which never deliver a depth frame) never produce one.
//
// ⚠ Not thread-safe by itself: the caller serializes append/finalize on
//   sensorFileQueue.

final class DepthTarWriter {
  private let sessionDir: URL
  private var handle: FileHandle?

  init(sessionDir: URL) {
    self.sessionDir = sessionDir
  }

  /// Append one depth frame (and its confidence map, when present) as tar entries.
  func append(depthMap: CVPixelBuffer, confidenceMap: CVPixelBuffer?, frameIndex: Int) {
    guard let png = PixelEncoders.depthMapToPngData(depthMap) else { return }
    if handle == nil {
      let url = sessionDir.appendingPathComponent("depth.tar")
      FileManager.default.createFile(atPath: url.path, contents: nil)
      handle = try? FileHandle(forWritingTo: url)
    }
    guard let h = handle else { return }
    do {
      let name = String(format: "depth/%06d.png", frameIndex)
      try h.write(contentsOf: Self.tarHeader(name: name, size: png.count))
      try h.write(contentsOf: png)
      let pad = (512 - (png.count % 512)) % 512
      if pad > 0 { try h.write(contentsOf: Data(count: pad)) }

      if let conf = confidenceMap, let confPng = PixelEncoders.confidenceMapToPngData(conf) {
        let confName = String(format: "confidence/%06d.png", frameIndex)
        try h.write(contentsOf: Self.tarHeader(name: confName, size: confPng.count))
        try h.write(contentsOf: confPng)
        let confPad = (512 - (confPng.count % 512)) % 512
        if confPad > 0 { try h.write(contentsOf: Data(count: confPad)) }
      }
    } catch {
      NSLog("[DepthTarWriter] depth.tar write failed: %@", "\(error)")
    }
  }

  /// Write the tar trailer (2×512 zero blocks) and close. No-op when no depth
  /// frame ever arrived.
  func finalize() {
    guard let h = handle else { return }
    try? h.write(contentsOf: Data(count: 1024))
    try? h.synchronize()
    try? h.close()
    handle = nil
  }

  /// Build a 512-byte ustar header for a regular file.
  private static func tarHeader(name: String, size: Int) -> Data {
    var h = [UInt8](repeating: 0, count: 512)
    func put(_ s: String, _ offset: Int, _ maxLen: Int) {
      for (i, b) in Array(s.utf8).prefix(maxLen).enumerated() { h[offset + i] = b }
    }
    put(name, 0, 100)                            // name ("depth/NNNNNN.png"; 100-byte cap)
    put("0000644", 100, 7)                       // mode (octal)
    put("0000000", 108, 7)                       // uid
    put("0000000", 116, 7)                       // gid
    put(String(format: "%011o", size), 124, 11)  // size (octal)
    put("00000000000", 136, 11)                  // mtime (octal, 0)
    for i in 148..<156 { h[i] = 0x20 }           // chksum field is 8 spaces before computing
    h[156] = UInt8(ascii: "0")                   // typeflag '0' = regular file
    put("ustar", 257, 5)                         // magic "ustar\0"
    put("00", 263, 2)                            // version
    var sum = 0
    for b in h { sum += Int(b) }
    put(String(format: "%06o", sum), 148, 6)     // chksum (6 octal)
    h[154] = 0                                   // null
    h[155] = 0x20                                // space
    return Data(h)
  }
}

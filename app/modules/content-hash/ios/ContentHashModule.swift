import CryptoKit
import ExpoModulesCore
import Foundation

// content_hash (= 生 mp4 の SHA-256) のネイティブ計算。
//
// v0.1.4 の識別子は「生 mp4 のバイト内容の SHA-256」 (DATA_SPECS_JA.md)。 JS (Hermes) で
// 計算すると数 GB で数十分かかるため、 ここでファイルを 4MB ずつ順次読みながら
// CryptoKit SHA256 (= ハードウェア支援、 GB/s 級) で計算する。 ランダムアクセスは不要。
//
// 提供:
//   AsyncFunction("sha256File", path) 64 文字 hex を返す。 path は file:// URI か素の絶対パス。

public class ContentHashModule: Module {

  public func definition() -> ModuleDefinition {
    Name("ContentHash")

    AsyncFunction("sha256File") { (path: String, promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        let url: URL
        if path.hasPrefix("file://"), let parsed = URL(string: path) {
          url = parsed
        } else {
          url = URL(fileURLWithPath: path)
        }
        guard let stream = InputStream(url: url) else {
          promise.reject("CONTENT_HASH_OPEN_ERROR", "cannot open file: \(url.path)")
          return
        }
        stream.open()
        defer { stream.close() }

        var hasher = SHA256()
        let bufSize = 4 * 1024 * 1024
        var buf = [UInt8](repeating: 0, count: bufSize)
        var total = 0
        while true {
          // autoreleasepool: NSInputStream.read can create bridged ObjC temporaries;
          // draining per-chunk prevents accumulation over a multi-GB file.
          let n: Int = autoreleasepool {
            stream.read(&buf, maxLength: bufSize)
          }
          if n < 0 {
            let msg = stream.streamError?.localizedDescription ?? "read failed"
            promise.reject("CONTENT_HASH_READ_ERROR", "\(msg) (at byte \(total))")
            return
          }
          if n == 0 { break }
          hasher.update(data: Data(bytes: buf, count: n))
          total += n
        }
        if total == 0 {
          promise.reject("CONTENT_HASH_EMPTY_ERROR", "file is empty: \(url.path)")
          return
        }
        let hex = hasher.finalize().map { String(format: "%02x", $0) }.joined()
        promise.resolve(hex)
      }
    }

    Function("getMemoryMB") { () -> Double in
      var info = task_vm_info_data_t()
      var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<natural_t>.size)
      let kr = withUnsafeMutablePointer(to: &info) {
        $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
          task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
        }
      }
      return kr == KERN_SUCCESS ? Double(info.phys_footprint) / 1_000_000.0 : -1
    }
  }
}

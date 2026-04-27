import Foundation

/// 時系列サンプル用のスレッドセーフなリングバッファ。
/// Sample が `timestampNs: UInt64` を持つことを protocol で要求する。
protocol TimedSample {
  var timestampNs: UInt64 { get }
}

final class SampleRingBuffer<S: TimedSample> {
  private var buffer: [S] = []
  private let maxSamples: Int
  private let lock = NSLock()

  init(maxSamples: Int = 4096) {
    self.maxSamples = maxSamples
  }

  func push(_ s: S) {
    lock.lock()
    buffer.append(s)
    if buffer.count > maxSamples {
      buffer.removeFirst(buffer.count - maxSamples)
    }
    lock.unlock()
  }

  func clear() {
    lock.lock()
    buffer.removeAll()
    lock.unlock()
  }

  /// timestampNs が [startNs, endNs] (inclusive) に入る sample を返す。
  func sliceByTimestamp(startNs: UInt64, endNs: UInt64) -> [S] {
    lock.lock()
    defer { lock.unlock() }
    return buffer.filter { $0.timestampNs >= startNs && $0.timestampNs <= endNs }
  }

  func snapshot() -> [S] {
    lock.lock()
    defer { lock.unlock() }
    return buffer
  }
}

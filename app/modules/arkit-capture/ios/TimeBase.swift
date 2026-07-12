import Foundation

/// ARFrame.timestamp and CMDeviceMotion.timestamp are both monotonic seconds
/// since boot, on the same clock. Converted to nanoseconds they serve directly
/// as the shared timestamp across every sensor stream. The clock is only
/// meaningful within a session.
@inline(__always)
func arkitTimestampToNs(_ seconds: TimeInterval) -> UInt64 {
  // Clamp negatives, NaN, and extremes to 0: a zero is easier for downstream
  // tooling to detect than a bogus timestamp.
  guard seconds.isFinite, seconds > 0 else { return 0 }
  let ns = seconds * 1_000_000_000
  if ns >= Double(UInt64.max) { return UInt64.max }
  return UInt64(ns)
}

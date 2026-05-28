import Foundation

/// ARFrame.timestamp / CMDeviceMotion.timestamp はどちらも boot からの monotonic 秒。
/// 同じ時計を共有しているので、 MCAP の log_time には ns 化してそのまま入れる。
/// この時計を「セッション内のみ有効」 として運用する (= STERA.md §4.2)。
@inline(__always)
func arkitTimestampToNs(_ seconds: TimeInterval) -> UInt64 {
  // 負・NaN・極端値は 0 に丸める (= 不正な timestamp が記録されるよりは 0 の方が
  // 後段で検出しやすい)
  guard seconds.isFinite, seconds > 0 else { return 0 }
  let ns = seconds * 1_000_000_000
  if ns >= Double(UInt64.max) { return UInt64.max }
  return UInt64(ns)
}

/// ROS 1 header.stamp は uint32 sec + uint32 nanosec。 ns から分解する。
@inline(__always)
func splitNsToRosTime(_ ns: UInt64) -> (sec: UInt32, nsec: UInt32) {
  let sec = ns / 1_000_000_000
  let nsec = ns % 1_000_000_000
  return (UInt32(truncatingIfNeeded: sec), UInt32(truncatingIfNeeded: nsec))
}

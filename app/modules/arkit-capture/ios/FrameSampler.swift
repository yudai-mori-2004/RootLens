import Foundation

/// Deterministic per-stream frame sampler.
///
/// Slots live on a fixed timestamp grid anchored at the first frame
/// (slot k = start + k / targetFps), so the output cadence never drifts with
/// source jitter and the expected-vs-written gap stays measurable. Tracking
/// pauses shift the grid by their duration instead of banking overdue slots,
/// so a recovery never bursts.
final class FrameSampler {
  private var encodeFrameIntervalNs: Int64
  private var sessionStartTimestampNs = Int64.min
  private var deterministicFrameIndex: Int64 = 0
  private(set) var totalExpectedFrameCount: Int64 = 0
  private var cumulativeTrackingPauseNs: Int64 = 0

  init(targetFps: Int) {
    encodeFrameIntervalNs = Int64(1_000_000_000 / max(targetFps, 1))
  }

  func configure(targetFps: Int) {
    encodeFrameIntervalNs = Int64(1_000_000_000 / max(targetFps, 1))
  }

  func reset() {
    sessionStartTimestampNs = Int64.min
    deterministicFrameIndex = 0
    totalExpectedFrameCount = 0
    cumulativeTrackingPauseNs = 0
  }

  /// Shift the slot grid past a tracking outage so paused time produces no slots.
  func recordTrackingPauseOffset(_ pauseNs: Int64) {
    cumulativeTrackingPauseNs += max(0, pauseNs)
  }

  /// True when this frame lands in a slot that has not been filled yet.
  func shouldEncodeFrame(timestampNs: Int64) -> Bool {
    if sessionStartTimestampNs == Int64.min {
      sessionStartTimestampNs = timestampNs
      deterministicFrameIndex = 0
      totalExpectedFrameCount = 0
    }
    let elapsedNs = max(timestampNs - sessionStartTimestampNs - cumulativeTrackingPauseNs, 0)
    let expectedFramesByNow = (elapsedNs / encodeFrameIntervalNs) + 1
    if expectedFramesByNow > totalExpectedFrameCount {
      totalExpectedFrameCount = expectedFramesByNow
    }
    if expectedFramesByNow <= deterministicFrameIndex { return false }
    deterministicFrameIndex = expectedFramesByNow
    return true
  }
}

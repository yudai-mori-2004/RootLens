package io.rootlens.mentra;

/** Immutable video-to-IMU association calibration used for one complete clip. */
final class VideoImuCalibration {
    static final String CONVENTION = "imu_event_timestamp_minus_video_event_timestamp";

    final String calibrationId;
    final long offsetNs;
    final String source;
    final long calibratedAtEpochMs;
    final double fullCorrelation;
    final double peakProminence;
    final int acceptedWindowCount;
    final long windowMadNs;

    VideoImuCalibration(
            String calibrationId,
            long offsetNs,
            String source,
            long calibratedAtEpochMs,
            double fullCorrelation,
            double peakProminence,
            int acceptedWindowCount,
            long windowMadNs) {
        this.calibrationId = calibrationId;
        this.offsetNs = offsetNs;
        this.source = source;
        this.calibratedAtEpochMs = calibratedAtEpochMs;
        this.fullCorrelation = fullCorrelation;
        this.peakProminence = peakProminence;
        this.acceptedWindowCount = acceptedWindowCount;
        this.windowMadNs = windowMadNs;
    }

    static VideoImuCalibration auditedDefault() {
        return new VideoImuCalibration(
                "mentra-live-controlled-motion-v1",
                AppContract.DEFAULT_VIDEO_TO_IMU_OFFSET_NS,
                "audited_60_second_controlled_motion",
                0L,
                0.9685364581,
                0.0,
                1,
                4_000_000L);
    }
}

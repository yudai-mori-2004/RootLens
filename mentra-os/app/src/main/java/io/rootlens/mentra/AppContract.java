package io.rootlens.mentra;

final class AppContract {
    static final String ACTION_START = "io.rootlens.mentra.START";
    static final String ACTION_STOP = "io.rootlens.mentra.STOP";
    static final String ACTION_TOGGLE = "io.rootlens.mentra.TOGGLE";
    static final String ACTION_PROBE = "io.rootlens.mentra.PROBE";
    static final String ACTION_STATUS = "io.rootlens.mentra.STATUS";
    static final String ACTION_UPLOAD = "io.rootlens.mentra.UPLOAD";
    static final String ACTION_CALIBRATE = "io.rootlens.mentra.CALIBRATE";
    static final String ACTION_CANCEL_CALIBRATION = "io.rootlens.mentra.CANCEL_CALIBRATION";
    static final String ACTION_PROVISION_ACCOUNT = "io.rootlens.mentra.PROVISION_ACCOUNT";

    static final String EXTRA_DURATION_SECONDS = "duration_seconds";
    static final String EXTRA_BITRATE_BPS = "bitrate_bps";
    static final String EXTRA_COMMAND_ID = "command_id";
    static final String EXTRA_OPERATION_PREACQUIRED = "operation_preacquired";

    static final int WIDTH = 1920;
    static final int HEIGHT = 1080;
    static final int FPS = 30;
    static final int DEFAULT_BITRATE_BPS = 7_000_000;
    static final int AUDIO_SAMPLE_RATE_HZ = 48_000;
    static final int AUDIO_CHANNELS = 1;
    static final int AUDIO_BITRATE_BPS = 96_000;
    static final int STORAGE_PREFLIGHT_SECONDS = 30 * 60;
    static final int MAX_SESSION_SECONDS = 5 * 60 * 60;
    static final int CALIBRATION_DURATION_SECONDS = 5 * 60;
    static final int IMU_PERIOD_US = 5_000;
    // Positive means the IMU event timestamp follows the corresponding video-observed motion.
    static final long DEFAULT_VIDEO_TO_IMU_OFFSET_NS = 73_500_000L;

    static final String CHANNEL_ID = "rootlens_capture";
    static final int NOTIFICATION_ID = 4102;
    static final int UPLOAD_NOTIFICATION_ID = 4103;
    static final int PROVISION_NOTIFICATION_ID = 4105;
    static final int CALIBRATION_NOTIFICATION_ID = 4106;

    private AppContract() {}
}

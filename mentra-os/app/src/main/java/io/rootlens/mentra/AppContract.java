package io.rootlens.mentra;

final class AppContract {
    static final String ACTION_START = "io.rootlens.mentra.START";
    static final String ACTION_STOP = "io.rootlens.mentra.STOP";
    static final String ACTION_TOGGLE = "io.rootlens.mentra.TOGGLE";
    static final String ACTION_FIELD_READY = "io.rootlens.mentra.FIELD_READY";
    static final String ACTION_PROBE = "io.rootlens.mentra.PROBE";
    static final String ACTION_STATUS = "io.rootlens.mentra.STATUS";
    static final String ACTION_UPLOAD = "io.rootlens.mentra.UPLOAD";
    static final String ACTION_PROVISION_ACCOUNT = "io.rootlens.mentra.PROVISION_ACCOUNT";

    static final String EXTRA_DURATION_SECONDS = "duration_seconds";
    static final String EXTRA_BITRATE_BPS = "bitrate_bps";

    static final int WIDTH = 1920;
    static final int HEIGHT = 1080;
    static final int FPS = 30;
    static final int DEFAULT_BITRATE_BPS = 7_000_000;
    static final int MAX_CLIP_SECONDS = 30 * 60;
    static final int MAX_SESSION_SECONDS = 5 * 60 * 60;
    static final int IMU_PERIOD_US = 5_000;
    // Positive means the IMU event timestamp follows the corresponding video-observed motion.
    static final long VIDEO_TO_IMU_OFFSET_NS = 73_500_000L;

    static final String CHANNEL_ID = "rootlens_capture";
    static final String FIELD_CONTROL_CHANNEL_ID = "rootlens_field_control";
    static final int NOTIFICATION_ID = 4102;
    static final int UPLOAD_NOTIFICATION_ID = 4103;
    static final int FIELD_CONTROL_NOTIFICATION_ID = 4104;
    static final int PROVISION_NOTIFICATION_ID = 4105;

    private AppContract() {}
}

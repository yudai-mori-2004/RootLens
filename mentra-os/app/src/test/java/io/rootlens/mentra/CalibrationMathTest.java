package io.rootlens.mentra;

final class CalibrationMathTest {
    public static void main(String[] args) throws Exception {
        frameMotionRecoversKnownTranslation();
        robustCorrelationRecoversKnownOffset();
        motionlessCalibrationIsRejected();
        System.out.println("Calibration math tests passed");
    }

    private static void frameMotionRecoversKnownTranslation() {
        int width = 96;
        int height = 54;
        byte[] first = new byte[width * height];
        for (int y = 0; y < height; y++) {
            for (int x = 0; x < width; x++) {
                int texture = (x * 17 + y * 29 + (x * y * 7) + ((x / 7) % 2) * 91) & 0xff;
                first[y * width + x] = (byte) texture;
            }
        }
        int dx = 4;
        int dy = -3;
        byte[] shifted = new byte[first.length];
        for (int y = 0; y < height; y++) {
            for (int x = 0; x < width; x++) {
                int sourceX = Math.max(0, Math.min(width - 1, x - dx));
                int sourceY = Math.max(0, Math.min(height - 1, y - dy));
                shifted[y * width + x] = first[sourceY * width + sourceX];
            }
        }
        FrameMotionEstimator.Motion motion = FrameMotionEstimator.estimate(
                first, shifted, width, height);
        require(motion.valid, "translated textured frame is valid");
        require(Math.abs(Math.abs(motion.dx) - Math.abs(dx)) < 1.0, "horizontal shift recovered");
        require(Math.abs(Math.abs(motion.dy) - Math.abs(dy)) < 1.0, "vertical shift recovered");
    }

    private static void robustCorrelationRecoversKnownOffset() throws Exception {
        long expectedOffsetNs = 74_500_000L;
        int visualCount = 300 * 15;
        long[] visualTimes = new long[visualCount];
        double[] visual = new double[visualCount];
        for (int index = 0; index < visualCount; index++) {
            double seconds = index / 15.0;
            visualTimes[index] = Math.round(seconds * 1_000_000_000L);
            visual[index] = signal(seconds) + deterministicNoise(index, 0.015);
        }

        int gyroCount = 300 * 200 + 100;
        long[] gyroTimes = new long[gyroCount];
        double[] gyro = new double[gyroCount];
        for (int index = 0; index < gyroCount; index++) {
            double seconds = index / 200.0;
            gyroTimes[index] = Math.round(seconds * 1_000_000_000L);
            gyro[index] = signal(seconds - expectedOffsetNs / 1_000_000_000.0)
                    + deterministicNoise(index + 31, 0.01);
        }

        VideoImuOffsetEstimator.Result result = VideoImuOffsetEstimator.estimate(
                visualTimes, visual, gyroTimes, gyro);
        require(Math.abs(result.offsetNs - expectedOffsetNs) <= 1_000_000L,
                "known video-to-IMU offset recovered");
        require(result.fullCorrelation > 0.95, "full correlation is high");
        require(result.acceptedWindowCount >= 8, "independent windows agree");
        require(result.windowMadNs <= 1_000_000L, "window estimate is stable");
    }

    private static void motionlessCalibrationIsRejected() {
        long[] visualTimes = new long[300];
        double[] visual = new double[300];
        long[] gyroTimes = new long[3_000];
        double[] gyro = new double[3_000];
        for (int index = 0; index < visualTimes.length; index++) {
            visualTimes[index] = index * 66_666_667L;
            visual[index] = 1.0;
        }
        for (int index = 0; index < gyroTimes.length; index++) {
            gyroTimes[index] = index * 5_000_000L;
            gyro[index] = 0.01;
        }
        try {
            VideoImuOffsetEstimator.estimate(visualTimes, visual, gyroTimes, gyro);
            throw new AssertionError("motionless calibration must fail");
        } catch (VideoImuOffsetEstimator.QualityException expected) {
            require(expected.getMessage().contains("correlation"), "failure explains low information");
        }
    }

    private static double signal(double seconds) {
        double chirp = Math.sin(0.8 * seconds + 0.0025 * seconds * seconds);
        double second = Math.sin(1.71 * seconds + 0.4 * Math.sin(0.037 * seconds));
        double pulse = Math.max(0.0, Math.sin(0.19 * seconds + 0.0007 * seconds * seconds));
        return 0.35 + Math.abs(chirp) + 0.45 * Math.abs(second) + 0.55 * pulse * pulse;
    }

    private static double deterministicNoise(int index, double scale) {
        int value = (index * 1103515245 + 12345) >>> 16;
        return ((value & 0x7fff) / 16384.0 - 1.0) * scale;
    }

    private static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    private CalibrationMathTest() {}
}

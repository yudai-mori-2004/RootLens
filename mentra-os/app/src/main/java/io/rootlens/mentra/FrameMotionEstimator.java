package io.rootlens.mentra;

/** Estimates global image translation from horizontal and vertical edge projections. */
final class FrameMotionEstimator {
    static final int SEARCH_RADIUS = 14;

    static final class Motion {
        final boolean valid;
        final double dx;
        final double dy;
        final double confidence;

        Motion(boolean valid, double dx, double dy, double confidence) {
            this.valid = valid;
            this.dx = dx;
            this.dy = dy;
            this.confidence = confidence;
        }

        double magnitude() {
            return Math.hypot(dx, dy);
        }
    }

    static Motion estimate(byte[] previous, byte[] current, int width, int height) {
        if (previous.length != width * height || current.length != previous.length) {
            throw new IllegalArgumentException("grayscale frame dimensions do not match");
        }
        double[] previousColumns = columnEdges(previous, width, height);
        double[] currentColumns = columnEdges(current, width, height);
        double[] previousRows = rowEdges(previous, width, height);
        double[] currentRows = rowEdges(current, width, height);
        Shift horizontal = bestShift(previousColumns, currentColumns);
        Shift vertical = bestShift(previousRows, currentRows);
        double confidence = Math.min(horizontal.correlation, vertical.correlation);
        boolean valid = Math.max(horizontal.correlation, vertical.correlation) >= 0.55
                && confidence >= 0.20;
        return new Motion(valid, horizontal.shift, vertical.shift, confidence);
    }

    private static double[] columnEdges(byte[] image, int width, int height) {
        double[] profile = new double[width - 2];
        for (int y = 1; y < height - 1; y++) {
            int row = y * width;
            for (int x = 1; x < width - 1; x++) {
                int left = image[row + x - 1] & 0xff;
                int right = image[row + x + 1] & 0xff;
                profile[x - 1] += Math.abs(right - left);
            }
        }
        return profile;
    }

    private static double[] rowEdges(byte[] image, int width, int height) {
        double[] profile = new double[height - 2];
        for (int y = 1; y < height - 1; y++) {
            int previousRow = (y - 1) * width;
            int nextRow = (y + 1) * width;
            for (int x = 1; x < width - 1; x++) {
                int above = image[previousRow + x] & 0xff;
                int below = image[nextRow + x] & 0xff;
                profile[y - 1] += Math.abs(below - above);
            }
        }
        return profile;
    }

    private static Shift bestShift(double[] previous, double[] current) {
        double[] scores = new double[SEARCH_RADIUS * 2 + 1];
        int bestIndex = 0;
        double best = -1.0;
        for (int shift = -SEARCH_RADIUS; shift <= SEARCH_RADIUS; shift++) {
            double score = correlation(previous, current, shift);
            int index = shift + SEARCH_RADIUS;
            scores[index] = score;
            if (score > best) {
                best = score;
                bestIndex = index;
            }
        }
        double refined = bestIndex - SEARCH_RADIUS;
        if (bestIndex > 0 && bestIndex + 1 < scores.length) {
            double left = scores[bestIndex - 1];
            double center = scores[bestIndex];
            double right = scores[bestIndex + 1];
            double denominator = left - 2.0 * center + right;
            if (Math.abs(denominator) > 1e-9) {
                double delta = 0.5 * (left - right) / denominator;
                refined += Math.max(-0.5, Math.min(0.5, delta));
            }
        }
        return new Shift(refined, best);
    }

    private static double correlation(double[] first, double[] second, int shift) {
        int firstStart = Math.max(0, -shift);
        int secondStart = Math.max(0, shift);
        int count = Math.min(first.length - firstStart, second.length - secondStart);
        if (count < 12) return -1.0;
        double sumFirst = 0;
        double sumSecond = 0;
        for (int index = 0; index < count; index++) {
            sumFirst += first[firstStart + index];
            sumSecond += second[secondStart + index];
        }
        double meanFirst = sumFirst / count;
        double meanSecond = sumSecond / count;
        double covariance = 0;
        double varianceFirst = 0;
        double varianceSecond = 0;
        for (int index = 0; index < count; index++) {
            double a = first[firstStart + index] - meanFirst;
            double b = second[secondStart + index] - meanSecond;
            covariance += a * b;
            varianceFirst += a * a;
            varianceSecond += b * b;
        }
        double denominator = Math.sqrt(varianceFirst * varianceSecond);
        return denominator <= 1e-9 ? -1.0 : covariance / denominator;
    }

    private static final class Shift {
        final double shift;
        final double correlation;

        Shift(double shift, double correlation) {
            this.shift = shift;
            this.correlation = correlation;
        }
    }

    private FrameMotionEstimator() {}
}

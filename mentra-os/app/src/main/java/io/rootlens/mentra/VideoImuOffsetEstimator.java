package io.rootlens.mentra;

import java.util.ArrayList;
import java.util.Arrays;

/** Robust cross-correlation policy for a visual-motion signal and raw gyroscope magnitude. */
final class VideoImuOffsetEstimator {
    static final long MIN_OFFSET_NS = -100_000_000L;
    static final long MAX_OFFSET_NS = 250_000_000L;
    static final long OFFSET_STEP_NS = 500_000L;
    static final long WINDOW_NS = 15_000_000_000L;
    static final double MIN_FULL_CORRELATION = 0.75;
    static final double MIN_FULL_PROMINENCE = 0.005;
    static final int MIN_ACCEPTED_WINDOWS = 8;
    static final long MAX_WINDOW_MAD_NS = 6_000_000L;
    static final long MAX_FULL_TO_MEDIAN_DELTA_NS = 8_000_000L;

    static final class Result {
        final long offsetNs;
        final double fullCorrelation;
        final double peakProminence;
        final int acceptedWindowCount;
        final double medianWindowCorrelation;
        final long windowMadNs;
        final long fullSequenceOffsetNs;

        Result(
                long offsetNs,
                double fullCorrelation,
                double peakProminence,
                int acceptedWindowCount,
                double medianWindowCorrelation,
                long windowMadNs,
                long fullSequenceOffsetNs) {
            this.offsetNs = offsetNs;
            this.fullCorrelation = fullCorrelation;
            this.peakProminence = peakProminence;
            this.acceptedWindowCount = acceptedWindowCount;
            this.medianWindowCorrelation = medianWindowCorrelation;
            this.windowMadNs = windowMadNs;
            this.fullSequenceOffsetNs = fullSequenceOffsetNs;
        }
    }

    static final class QualityException extends Exception {
        QualityException(String message) {
            super(message);
        }
    }

    static Result estimate(
            long[] visualTimestampsNs,
            double[] visualMotion,
            long[] gyroTimestampsNs,
            double[] gyroMagnitude) throws QualityException {
        validateInputs(visualTimestampsNs, visualMotion, gyroTimestampsNs, gyroMagnitude);
        Scan full = scan(visualTimestampsNs, visualMotion, gyroTimestampsNs, gyroMagnitude,
                Long.MIN_VALUE, Long.MAX_VALUE, 120);
        if (full.correlation < MIN_FULL_CORRELATION) {
            throw new QualityException("full correlation too low: " + full.correlation);
        }
        if (full.prominence < MIN_FULL_PROMINENCE) {
            throw new QualityException("offset peak is ambiguous: " + full.prominence);
        }

        long first = visualTimestampsNs[0];
        long last = visualTimestampsNs[visualTimestampsNs.length - 1];
        ArrayList<Long> offsets = new ArrayList<>();
        ArrayList<Double> correlations = new ArrayList<>();
        for (long start = first; start < last; start += WINDOW_NS) {
            Scan window = scan(visualTimestampsNs, visualMotion, gyroTimestampsNs, gyroMagnitude,
                    start, Math.min(last + 1, start + WINDOW_NS), 80);
            if (window.correlation >= 0.60 && window.prominence >= 0.001) {
                offsets.add(window.offsetNs);
                correlations.add(window.correlation);
            }
        }
        if (offsets.size() < MIN_ACCEPTED_WINDOWS) {
            throw new QualityException("too few high-confidence windows: " + offsets.size());
        }
        long[] acceptedOffsets = new long[offsets.size()];
        double[] acceptedCorrelations = new double[correlations.size()];
        for (int index = 0; index < offsets.size(); index++) {
            acceptedOffsets[index] = offsets.get(index);
            acceptedCorrelations[index] = correlations.get(index);
        }
        Arrays.sort(acceptedOffsets);
        Arrays.sort(acceptedCorrelations);
        long medianOffset = median(acceptedOffsets);
        long[] deviations = new long[acceptedOffsets.length];
        for (int index = 0; index < acceptedOffsets.length; index++) {
            deviations[index] = Math.abs(acceptedOffsets[index] - medianOffset);
        }
        Arrays.sort(deviations);
        long mad = median(deviations);
        if (mad > MAX_WINDOW_MAD_NS) {
            throw new QualityException("window offset MAD too high: " + mad);
        }
        if (Math.abs(full.offsetNs - medianOffset) > MAX_FULL_TO_MEDIAN_DELTA_NS) {
            throw new QualityException("full and window estimates disagree");
        }
        double finalCorrelation = correlationAt(
                visualTimestampsNs, visualMotion, gyroTimestampsNs, gyroMagnitude,
                medianOffset, Long.MIN_VALUE, Long.MAX_VALUE, 120);
        if (finalCorrelation < MIN_FULL_CORRELATION) {
            throw new QualityException("robust median correlation too low: " + finalCorrelation);
        }
        return new Result(
                medianOffset,
                finalCorrelation,
                full.prominence,
                acceptedOffsets.length,
                acceptedCorrelations[acceptedCorrelations.length / 2],
                mad,
                full.offsetNs);
    }

    private static Scan scan(
            long[] visualTimes,
            double[] visual,
            long[] gyroTimes,
            double[] gyro,
            long start,
            long end,
            int minimumPairs) {
        int count = (int) ((MAX_OFFSET_NS - MIN_OFFSET_NS) / OFFSET_STEP_NS) + 1;
        double[] scores = new double[count];
        int bestIndex = 0;
        double best = -2.0;
        for (int index = 0; index < count; index++) {
            long offset = MIN_OFFSET_NS + index * OFFSET_STEP_NS;
            double score = correlationAt(
                    visualTimes, visual, gyroTimes, gyro, offset, start, end, minimumPairs);
            scores[index] = score;
            if (score > best) {
                best = score;
                bestIndex = index;
            }
        }
        if (best <= -1.5) return new Scan(0L, -2.0, 0.0);
        double refinedIndex = bestIndex;
        if (bestIndex > 0 && bestIndex + 1 < scores.length) {
            double left = scores[bestIndex - 1];
            double center = scores[bestIndex];
            double right = scores[bestIndex + 1];
            double denominator = left - 2.0 * center + right;
            if (Math.abs(denominator) > 1e-9) {
                refinedIndex += Math.max(-0.5, Math.min(0.5,
                        0.5 * (left - right) / denominator));
            }
        }
        long refinedOffset = Math.round(MIN_OFFSET_NS + refinedIndex * OFFSET_STEP_NS);
        double second = -2.0;
        int exclusion = (int) (40_000_000L / OFFSET_STEP_NS);
        for (int index = 0; index < scores.length; index++) {
            if (Math.abs(index - bestIndex) > exclusion) second = Math.max(second, scores[index]);
        }
        return new Scan(refinedOffset, best, best - second);
    }

    private static double correlationAt(
            long[] visualTimes,
            double[] visual,
            long[] gyroTimes,
            double[] gyro,
            long offset,
            long start,
            long end,
            int minimumPairs) {
        Stats stats = new Stats();
        for (int index = 0; index < visualTimes.length; index++) {
            long time = visualTimes[index];
            if (time < start || time >= end) continue;
            double gyroValue = interpolate(gyroTimes, gyro, time + offset);
            if (!Double.isFinite(gyroValue) || !Double.isFinite(visual[index])) continue;
            stats.add(visual[index], gyroValue);
        }
        return stats.count < minimumPairs ? -2.0 : stats.correlation();
    }

    private static double interpolate(long[] times, double[] values, long target) {
        int index = Arrays.binarySearch(times, target);
        if (index >= 0) return values[index];
        int after = -index - 1;
        int before = after - 1;
        if (before < 0 || after >= times.length) return Double.NaN;
        long span = times[after] - times[before];
        if (span <= 0) return Double.NaN;
        double ratio = (target - times[before]) / (double) span;
        return values[before] + ratio * (values[after] - values[before]);
    }

    private static void validateInputs(long[] visualTimes, double[] visual,
                                       long[] gyroTimes, double[] gyro) throws QualityException {
        if (visualTimes.length != visual.length || gyroTimes.length != gyro.length) {
            throw new QualityException("timestamp and signal lengths differ");
        }
        if (visualTimes.length < 120 || gyroTimes.length < 500) {
            throw new QualityException("insufficient calibration samples");
        }
        if (!strictlyIncreasing(visualTimes) || !strictlyIncreasing(gyroTimes)) {
            throw new QualityException("timestamps are not strictly increasing");
        }
    }

    private static boolean strictlyIncreasing(long[] values) {
        for (int index = 1; index < values.length; index++) {
            if (values[index] <= values[index - 1]) return false;
        }
        return true;
    }

    private static long median(long[] sorted) {
        return sorted[sorted.length / 2];
    }

    private static final class Scan {
        final long offsetNs;
        final double correlation;
        final double prominence;

        Scan(long offsetNs, double correlation, double prominence) {
            this.offsetNs = offsetNs;
            this.correlation = correlation;
            this.prominence = prominence;
        }
    }

    private static final class Stats {
        int count;
        double x;
        double y;
        double xx;
        double yy;
        double xy;

        void add(double first, double second) {
            count++;
            x += first;
            y += second;
            xx += first * first;
            yy += second * second;
            xy += first * second;
        }

        double correlation() {
            double covariance = xy - x * y / count;
            double varianceX = xx - x * x / count;
            double varianceY = yy - y * y / count;
            double denominator = Math.sqrt(Math.max(0, varianceX * varianceY));
            return denominator <= 1e-12 ? -2.0 : covariance / denominator;
        }
    }

    private VideoImuOffsetEstimator() {}
}

package io.rootlens.mentra;

import android.graphics.Bitmap;
import android.media.MediaMetadataRetriever;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/** Decodes a calibration clip and derives a robust visual-motion-to-gyroscope offset. */
final class CalibrationAnalyzer {
    interface Progress {
        void onProgress(int processedFrames, int totalFrames);
    }

    static final long REQUIRED_CAPTURE_DURATION_NS = 4L * 60L * 1_000_000_000L;
    private static final int SAMPLE_STRIDE = 3;
    private static final int BATCH_SIZE = 12;
    private static final int ANALYSIS_WIDTH = 96;
    private static final int ANALYSIS_HEIGHT = 54;

    static final class Analysis {
        final VideoImuOffsetEstimator.Result result;
        final long captureDurationNs;
        final int visualSampleCount;
        final int gyroSampleCount;

        Analysis(VideoImuOffsetEstimator.Result result, long captureDurationNs,
                 int visualSampleCount, int gyroSampleCount) {
            this.result = result;
            this.captureDurationNs = captureDurationNs;
            this.visualSampleCount = visualSampleCount;
            this.gyroSampleCount = gyroSampleCount;
        }
    }

    static Analysis analyze(File directory, Progress progress)
            throws IOException, VideoImuOffsetEstimator.QualityException {
        long[] frameTimes = readFrameTimes(new File(directory, "frames.jsonl"));
        if (frameTimes.length < 2) throw new IOException("calibration clip has no frame timeline");
        long duration = frameTimes[frameTimes.length - 1] - frameTimes[0];
        if (duration < REQUIRED_CAPTURE_DURATION_NS) {
            throw new VideoImuOffsetEstimator.QualityException(
                    "calibration capture shorter than four minutes");
        }
        Signal gyro = readGyroscope(new File(directory, "imu.jsonl"));
        Signal visual = extractVisualMotion(
                new File(directory, "rgb.mp4"), frameTimes, progress);
        VideoImuOffsetEstimator.Result result = VideoImuOffsetEstimator.estimate(
                visual.timestamps, visual.values, gyro.timestamps, gyro.values);
        return new Analysis(result, duration, visual.values.length, gyro.values.length);
    }

    private static Signal extractVisualMotion(File video, long[] frameTimes, Progress progress)
            throws IOException {
        MediaMetadataRetriever retriever = new MediaMetadataRetriever();
        try {
            retriever.setDataSource(video.getAbsolutePath());
            int metadataCount = parsePositiveInt(retriever.extractMetadata(
                    MediaMetadataRetriever.METADATA_KEY_VIDEO_FRAME_COUNT));
            int total = Math.min(metadataCount, frameTimes.length);
            if (total < 120) throw new IOException("calibration video has too few frames");
            MediaMetadataRetriever.BitmapParams params =
                    new MediaMetadataRetriever.BitmapParams();
            params.setPreferredConfig(Bitmap.Config.RGB_565);
            ArrayList<Long> motionTimes = new ArrayList<>();
            ArrayList<Double> motionValues = new ArrayList<>();
            byte[] previous = null;
            long previousTime = 0L;

            for (int start = 0; start < total; start += BATCH_SIZE) {
                int count = Math.min(BATCH_SIZE, total - start);
                List<Bitmap> frames = retriever.getFramesAtIndex(start, count, params);
                if (frames == null || frames.isEmpty()) {
                    throw new IOException("decoder returned no frames at index " + start);
                }
                for (int local = 0; local < frames.size(); local++) {
                    Bitmap frame = frames.get(local);
                    int frameIndex = start + local;
                    try {
                        if (frameIndex % SAMPLE_STRIDE != 0) continue;
                        byte[] grayscale = grayscale(frame);
                        long time = frameTimes[frameIndex];
                        if (previous != null) {
                            long deltaNs = time - previousTime;
                            FrameMotionEstimator.Motion motion = FrameMotionEstimator.estimate(
                                    previous, grayscale, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
                            if (deltaNs > 0 && motion.valid
                                    && Math.abs(motion.dx) < FrameMotionEstimator.SEARCH_RADIUS - 0.5
                                    && Math.abs(motion.dy) < FrameMotionEstimator.SEARCH_RADIUS - 0.5) {
                                motionTimes.add(previousTime + deltaNs / 2L);
                                motionValues.add(motion.magnitude()
                                        / (deltaNs / 1_000_000_000.0));
                            }
                        }
                        previous = grayscale;
                        previousTime = time;
                    } finally {
                        frame.recycle();
                    }
                }
                if (progress != null) progress.onProgress(
                        Math.min(total, start + frames.size()), total);
            }
            return signal(motionTimes, motionValues);
        } catch (IllegalArgumentException | IllegalStateException error) {
            throw new IOException("calibration video decode failed", error);
        } finally {
            try {
                retriever.release();
            } catch (IOException ignored) {
            }
        }
    }

    private static byte[] grayscale(Bitmap source) {
        Bitmap scaled = Bitmap.createScaledBitmap(
                source, ANALYSIS_WIDTH, ANALYSIS_HEIGHT, true);
        int[] pixels = new int[ANALYSIS_WIDTH * ANALYSIS_HEIGHT];
        scaled.getPixels(pixels, 0, ANALYSIS_WIDTH, 0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
        byte[] grayscale = new byte[pixels.length];
        for (int index = 0; index < pixels.length; index++) {
            int color = pixels[index];
            int red = (color >>> 16) & 0xff;
            int green = (color >>> 8) & 0xff;
            int blue = color & 0xff;
            grayscale[index] = (byte) ((red * 77 + green * 150 + blue * 29) >>> 8);
        }
        if (scaled != source) scaled.recycle();
        return grayscale;
    }

    private static long[] readFrameTimes(File file) throws IOException {
        ArrayList<Long> values = new ArrayList<>();
        try (BufferedReader reader = new BufferedReader(new FileReader(file), 1024 * 1024)) {
            String line;
            while ((line = reader.readLine()) != null) {
                try {
                    values.add(new JSONObject(line)
                            .getLong("video_frame_timestamp_elapsed_realtime_ns"));
                } catch (JSONException error) {
                    throw new IOException("invalid frame timestamp JSON", error);
                }
            }
        }
        long[] result = new long[values.size()];
        for (int index = 0; index < result.length; index++) result[index] = values.get(index);
        return result;
    }

    private static Signal readGyroscope(File file) throws IOException {
        ArrayList<Long> times = new ArrayList<>();
        ArrayList<Double> magnitudes = new ArrayList<>();
        try (BufferedReader reader = new BufferedReader(new FileReader(file), 1024 * 1024)) {
            String line;
            while ((line = reader.readLine()) != null) {
                try {
                    JSONObject row = new JSONObject(line);
                    if (!"gyroscope".equals(row.optString("sensor"))) continue;
                    double x = row.getDouble("x");
                    double y = row.getDouble("y");
                    double z = row.getDouble("z");
                    times.add(row.getLong("timestamp_ns"));
                    magnitudes.add(Math.sqrt(x * x + y * y + z * z));
                } catch (JSONException error) {
                    throw new IOException("invalid gyroscope JSON", error);
                }
            }
        }
        return signal(times, magnitudes);
    }

    private static Signal signal(ArrayList<Long> times, ArrayList<Double> values) {
        long[] timestamps = new long[times.size()];
        double[] samples = new double[values.size()];
        for (int index = 0; index < times.size(); index++) {
            timestamps[index] = times.get(index);
            samples[index] = values.get(index);
        }
        return new Signal(timestamps, samples);
    }

    private static int parsePositiveInt(String value) throws IOException {
        try {
            int result = Integer.parseInt(value);
            if (result <= 0) throw new NumberFormatException();
            return result;
        } catch (NumberFormatException error) {
            throw new IOException("video frame count is unavailable", error);
        }
    }

    private static final class Signal {
        final long[] timestamps;
        final double[] values;

        Signal(long[] timestamps, double[] values) {
            this.timestamps = timestamps;
            this.values = values;
        }
    }

    private CalibrationAnalyzer() {}
}

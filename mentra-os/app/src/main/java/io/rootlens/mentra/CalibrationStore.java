package io.rootlens.mentra;

import android.content.Context;
import android.os.Build;
import android.util.AtomicFile;
import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.UUID;

/** Atomic, device-bound storage for the one calibration applied to future clips. */
final class CalibrationStore {
    private static final String TAG = "RootLensCalibration";
    private static final String SCHEMA = "rootlens.mentra.video_imu_calibration.v1";
    private static final String FILE_NAME = "video_imu_calibration.json";

    static VideoImuCalibration resolve(Context context, String cameraId) {
        File file = internalFile(context);
        if (!file.isFile()) return VideoImuCalibration.auditedDefault();
        try {
            JSONObject value = new JSONObject(new String(
                    new AtomicFile(file).readFully(), StandardCharsets.UTF_8));
            if (!SCHEMA.equals(value.optString("schema"))) {
                throw new IOException("unknown calibration schema");
            }
            if (!Build.FINGERPRINT.equals(value.optString("android_build_fingerprint"))) {
                throw new IOException("calibration belongs to a different firmware build");
            }
            if (!cameraId.equals(value.optString("camera_id"))) {
                throw new IOException("calibration belongs to a different camera");
            }
            if (value.optInt("width") != AppContract.WIDTH
                    || value.optInt("height") != AppContract.HEIGHT
                    || value.optInt("fps") != AppContract.FPS) {
                throw new IOException("calibration capture configuration differs");
            }
            long offset = value.getLong("offset_ns");
            if (offset < VideoImuOffsetEstimator.MIN_OFFSET_NS
                    || offset > VideoImuOffsetEstimator.MAX_OFFSET_NS) {
                throw new IOException("calibration offset is outside the accepted range");
            }
            return new VideoImuCalibration(
                    value.getString("calibration_id"),
                    offset,
                    value.getString("source"),
                    value.getLong("calibrated_at_epoch_ms"),
                    value.getDouble("full_correlation"),
                    value.getDouble("peak_prominence"),
                    value.getInt("accepted_window_count"),
                    value.getLong("window_mad_ns"));
        } catch (IOException | JSONException error) {
            Log.e(TAG, "Stored calibration rejected; retaining audited default", error);
            return VideoImuCalibration.auditedDefault();
        }
    }

    static VideoImuCalibration commit(
            Context context,
            String cameraId,
            VideoImuOffsetEstimator.Result result,
            long captureDurationNs,
            int visualSampleCount,
            int gyroSampleCount) throws IOException {
        long calibratedAt = System.currentTimeMillis();
        VideoImuCalibration calibration = new VideoImuCalibration(
                UUID.randomUUID().toString(),
                result.offsetNs,
                "hidden_5x_long_press_5_minute_visual_gyro_correlation",
                calibratedAt,
                result.fullCorrelation,
                result.peakProminence,
                result.acceptedWindowCount,
                result.windowMadNs);
        JSONObject value = json(
                calibration,
                cameraId,
                captureDurationNs,
                visualSampleCount,
                gyroSampleCount,
                result);
        writeAtomic(new AtomicFile(internalFile(context)), value.toString() + "\n");
        writeAuditMirror(context, value);
        return calibration;
    }

    static JSONObject auditJson(VideoImuCalibration calibration) {
        try {
            return new JSONObject()
                    .put("calibration_id", calibration.calibrationId)
                    .put("offset_ns", calibration.offsetNs)
                    .put("convention", VideoImuCalibration.CONVENTION)
                    .put("source", calibration.source)
                    .put("calibrated_at_epoch_ms", calibration.calibratedAtEpochMs)
                    .put("full_correlation", calibration.fullCorrelation)
                    .put("peak_prominence", calibration.peakProminence)
                    .put("accepted_window_count", calibration.acceptedWindowCount)
                    .put("window_mad_ns", calibration.windowMadNs);
        } catch (JSONException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    private static JSONObject json(
            VideoImuCalibration calibration,
            String cameraId,
            long captureDurationNs,
            int visualSampleCount,
            int gyroSampleCount,
            VideoImuOffsetEstimator.Result result) throws IOException {
        try {
            return new JSONObject()
                    .put("schema", SCHEMA)
                    .put("calibration_id", calibration.calibrationId)
                    .put("source", calibration.source)
                    .put("offset_ns", calibration.offsetNs)
                    .put("convention", VideoImuCalibration.CONVENTION)
                    .put("calibrated_at_epoch_ms", calibration.calibratedAtEpochMs)
                    .put("android_build_fingerprint", Build.FINGERPRINT)
                    .put("camera_id", cameraId)
                    .put("width", AppContract.WIDTH)
                    .put("height", AppContract.HEIGHT)
                    .put("fps", AppContract.FPS)
                    .put("capture_duration_ns", captureDurationNs)
                    .put("visual_sample_count", visualSampleCount)
                    .put("gyro_sample_count", gyroSampleCount)
                    .put("full_correlation", result.fullCorrelation)
                    .put("full_sequence_offset_ns", result.fullSequenceOffsetNs)
                    .put("peak_prominence", result.peakProminence)
                    .put("accepted_window_count", result.acceptedWindowCount)
                    .put("median_window_correlation", result.medianWindowCorrelation)
                    .put("window_mad_ns", result.windowMadNs)
                    .put("quality_gate", "passed");
        } catch (JSONException error) {
            throw new IOException("calibration JSON construction failed", error);
        }
    }

    private static File internalFile(Context context) {
        Context protectedContext = context.createDeviceProtectedStorageContext();
        return new File(protectedContext.getFilesDir(), FILE_NAME);
    }

    private static void writeAtomic(AtomicFile file, String content) throws IOException {
        FileOutputStream stream = null;
        try {
            stream = file.startWrite();
            stream.write(content.getBytes(StandardCharsets.UTF_8));
            stream.getFD().sync();
            file.finishWrite(stream);
        } catch (IOException error) {
            if (stream != null) file.failWrite(stream);
            throw error;
        }
    }

    private static void writeAuditMirror(Context context, JSONObject value) throws IOException {
        File directory = new File(context.getExternalFilesDir(null), "calibration");
        if (!directory.exists() && !directory.mkdirs()) {
            throw new IOException("cannot create calibration audit directory");
        }
        File temporary = new File(directory, "current.json.tmp");
        File destination = new File(directory, "current.json");
        try (FileOutputStream output = new FileOutputStream(temporary, false)) {
            output.write((value.toString(2) + "\n").getBytes(StandardCharsets.UTF_8));
            output.getFD().sync();
        } catch (JSONException error) {
            throw new IOException("calibration audit serialization failed", error);
        }
        Files.move(temporary.toPath(), destination.toPath(),
                StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
    }

    private CalibrationStore() {}
}

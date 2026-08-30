package io.rootlens.mentra;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.hardware.camera2.CameraAccessException;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.IOException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;

/** Runs an explicit five-minute calibration capture and commits only a quality-gated result. */
public final class CalibrationService extends Service {
    private enum Phase { IDLE, STARTING, RECORDING, FINALIZING, ANALYZING, SUCCEEDED, FAILED }

    private static final String TAG = "RootLensCalibration";
    private static final long WAKE_LOCK_TIMEOUT_MS = 20L * 60L * 1_000L;
    private static final long GESTURE_CUE_CLEAR_MS = 700L;
    // Include I2S route cleanup after the 11.650562 s instruction asset.
    private static final long INSTRUCTIONS_AND_PAUSE_MS = 12_800L;

    private final ExecutorService serial = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private Phase phase = Phase.IDLE;
    private CaptureEngine engine;
    private Runnable pendingInstructions;
    private Runnable pendingStart;
    private Runnable pendingStop;
    private PowerManager.WakeLock wakeLock;
    private PowerManager.WakeLock screenWakeLock;
    private File directory;
    private String cameraId;
    private volatile boolean cancelled;

    @Override
    public void onCreate() {
        super.onCreate();
        getSystemService(NotificationManager.class).createNotificationChannel(
                new NotificationChannel(AppContract.CHANNEL_ID, "RootLens capture",
                        NotificationManager.IMPORTANCE_LOW));
        PowerManager power = getSystemService(PowerManager.class);
        wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,
                "RootLensMentra:calibration");
        screenWakeLock = power.newWakeLock(
                PowerManager.FULL_WAKE_LOCK
                        | PowerManager.ACQUIRE_CAUSES_WAKEUP
                        | PowerManager.ON_AFTER_RELEASE,
                "RootLensMentra:calibration-camera-start");
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Intent command = intent == null ? new Intent() : new Intent(intent);
        if (AppContract.ACTION_CANCEL_CALIBRATION.equals(command.getAction())) {
            // Set immediately on the main thread so an analysis already occupying the serial
            // executor cannot commit after the operator has cancelled the logical operation.
            cancelled = true;
        }
        startForeground(AppContract.CALIBRATION_NOTIFICATION_ID, notification("Preparing calibration"));
        submit(() -> handle(command));
        return START_NOT_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        mainHandler.removeCallbacksAndMessages(null);
        CaptureEngine abandoned = engine;
        engine = null;
        if (abandoned != null) abandoned.stop();
        releaseLocks();
        DeviceOperationGate.release(DeviceOperationGate.Owner.CALIBRATION);
        serial.shutdown();
        super.onDestroy();
    }

    private void handle(Intent command) {
        if (AppContract.ACTION_CANCEL_CALIBRATION.equals(command.getAction())) {
            cancel();
            return;
        }
        if (!AppContract.ACTION_CALIBRATE.equals(command.getAction()) || phase != Phase.IDLE) {
            publish();
            return;
        }
        boolean preacquired = command.getBooleanExtra(
                AppContract.EXTRA_OPERATION_PREACQUIRED, false);
        if ((!preacquired && !DeviceOperationGate.tryAcquire(DeviceOperationGate.Owner.CALIBRATION))
                || !DeviceOperationGate.isOwnedBy(DeviceOperationGate.Owner.CALIBRATION)) {
            fail(null, new IOException("Another camera operation is active"));
            return;
        }
        acquireLocks();
        phase = Phase.STARTING;
        writeStatus("starting", "Keep the glasses aimed at a textured scene");
        updateNotification("Calibration starts in a moment");
        wakeCameraAccessPath();
        pendingInstructions = () -> {
            pendingInstructions = null;
            if (phase != Phase.STARTING || cancelled) return;
            CaptureFeedback.calibrationInstructions(this);
            pendingStart = () -> submit(this::startCapture);
            mainHandler.postDelayed(pendingStart, INSTRUCTIONS_AND_PAUSE_MS);
        };
        mainHandler.postDelayed(pendingInstructions, GESTURE_CUE_CLEAR_MS);
    }

    private void startCapture() {
        pendingStart = null;
        if (phase != Phase.STARTING || cancelled) return;
        CaptureEngine[] holder = new CaptureEngine[1];
        CaptureEngine next = new CaptureEngine(
                this,
                AppContract.CALIBRATION_DURATION_SECONDS,
                AppContract.DEFAULT_BITRATE_BPS,
                true,
                new CaptureEngine.Listener() {
                    @Override
                    public void onStarted(File artifact, DeviceProbe.Snapshot probe) {
                        submit(() -> captureStarted(holder[0], artifact, probe));
                    }

                    @Override
                    public void onCompleted(File artifact) {
                        submit(() -> captureCompleted(holder[0], artifact));
                    }

                    @Override
                    public void onFailed(File artifact, Throwable error) {
                        submit(() -> fail(artifact, error));
                    }
                });
        holder[0] = next;
        engine = next;
        try {
            next.start();
        } catch (IOException | CameraAccessException | RuntimeException error) {
            if (engine == next) engine = null;
            fail(next.directory(), error);
        }
    }

    private void captureStarted(
            CaptureEngine source, File artifact, DeviceProbe.Snapshot probe) {
        if (engine != source || phase != Phase.STARTING) return;
        directory = artifact;
        cameraId = probe.cameraId;
        if (cancelled) {
            phase = Phase.FINALIZING;
            writeStatus("cancelling", "Cancelling calibration during camera open");
            updateNotification("Cancelling calibration");
            source.stop();
            return;
        }
        phase = Phase.RECORDING;
        writeStatus("recording", "Move left/right and up/down at varied speeds for five minutes");
        updateNotification("Calibrating · move glasses through a textured scene");
        pendingStop = () -> submit(() -> {
            pendingStop = null;
            if (phase != Phase.RECORDING || engine != source) return;
            phase = Phase.FINALIZING;
            writeStatus("finalizing", "Finalizing calibration capture");
            updateNotification("Finalizing calibration");
            source.stop();
        });
        mainHandler.postDelayed(
                pendingStop, AppContract.CALIBRATION_DURATION_SECONDS * 1_000L);
    }

    private void captureCompleted(CaptureEngine source, File artifact) {
        if (engine != source) return;
        engine = null;
        directory = artifact;
        removePendingStop();
        if (cancelled) {
            discardCalibrationArtifact(artifact);
            finishCancelled();
            return;
        }
        phase = Phase.ANALYZING;
        writeStatus("analyzing", "Measuring RGB-to-IMU offset");
        updateNotification("Analyzing calibration");
        try {
            CalibrationAnalyzer.Analysis analysis = CalibrationAnalyzer.analyze(
                    artifact,
                    (processed, total) -> updateNotification(
                            "Analyzing calibration · " + processed + "/" + total));
            if (cancelled) {
                discardCalibrationArtifact(artifact);
                finishCancelled();
                return;
            }
            VideoImuCalibration calibration = CalibrationStore.commit(
                    this,
                    cameraId,
                    analysis.result,
                    analysis.captureDurationNs,
                    analysis.visualSampleCount,
                    analysis.gyroSampleCount);
            writeCalibrationReport(artifact, "passed", null, calibration, analysis);
            if (!discardCalibrationArtifact(artifact)) {
                Log.w(TAG, "Calibration committed but raw cleanup is incomplete: " + artifact);
            }
            phase = Phase.SUCCEEDED;
            writeStatus("complete", "Calibration passed and was stored");
            updateNotification("Calibration complete");
            finish();
        } catch (IOException | VideoImuOffsetEstimator.QualityException error) {
            fail(artifact, error);
        }
    }

    private void cancel() {
        if (phase == Phase.IDLE || phase == Phase.SUCCEEDED || phase == Phase.FAILED) {
            finish();
            return;
        }
        cancelled = true;
        if (phase == Phase.STARTING) {
            removePendingStartup();
            CaptureFeedback.calibrationCancelled(this);
            if (engine == null) {
                finishCancelled();
            } else {
                // CameraDevice.openCamera is asynchronous. Keep ownership until its callback
                // reaches onStarted/onFailed, then close through CaptureEngine exactly once.
                writeStatus("cancelling", "Waiting for camera open to cancel safely");
                updateNotification("Cancelling calibration");
            }
            return;
        }
        if (phase == Phase.RECORDING && engine != null) {
            removePendingStop();
            phase = Phase.FINALIZING;
            writeStatus("cancelling", "Cancelling calibration");
            updateNotification("Cancelling calibration");
            CaptureFeedback.calibrationCancelled(this);
            engine.stop();
        }
    }

    private void fail(File artifact, Throwable error) {
        if (phase == Phase.FAILED || phase == Phase.SUCCEEDED) return;
        engine = null;
        removePendingStop();
        if (cancelled) {
            discardCalibrationArtifact(artifact);
            finishCancelled();
            return;
        }
        phase = Phase.FAILED;
        String message = error == null ? "Calibration failed" : error.toString();
        Log.e(TAG, "Calibration failed", error);
        if (artifact != null) {
            try {
                writeCalibrationReport(artifact, "failed", message, null, null);
            } catch (IOException reportError) {
                Log.e(TAG, "Could not write calibration failure report", reportError);
            }
        }
        // The previously accepted calibration remains untouched on every failure path.
        writeStatus("failed", message);
        updateNotification("Calibration failed · previous value retained");
        CaptureFeedback.failed(this);
        finish();
    }

    private void finishCancelled() {
        phase = Phase.FAILED;
        writeStatus("cancelled", "Calibration cancelled; previous value retained");
        updateNotification("Calibration cancelled");
        finish();
    }

    private void finish() {
        releaseLocks();
        DeviceOperationGate.release(DeviceOperationGate.Owner.CALIBRATION);
        stopForeground(false);
        stopSelf();
    }

    private void publish() {
        updateNotification(phase.name().toLowerCase());
    }

    private void removePendingStop() {
        if (pendingStop == null) return;
        mainHandler.removeCallbacks(pendingStop);
        pendingStop = null;
    }

    private void removePendingStartup() {
        if (pendingInstructions != null) {
            mainHandler.removeCallbacks(pendingInstructions);
            pendingInstructions = null;
        }
        if (pendingStart != null) {
            mainHandler.removeCallbacks(pendingStart);
            pendingStart = null;
        }
    }

    @SuppressWarnings("deprecation")
    private void acquireLocks() {
        if (!wakeLock.isHeld()) wakeLock.acquire(WAKE_LOCK_TIMEOUT_MS);
    }

    @SuppressWarnings("deprecation")
    private void wakeCameraAccessPath() {
        if (!screenWakeLock.isHeld()) screenWakeLock.acquire(10_000L);
        Intent foreground = new Intent(this, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        try {
            startActivity(foreground);
        } catch (RuntimeException error) {
            Log.w(TAG, "Could not bring calibration Activity to foreground", error);
        }
    }

    private void releaseLocks() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        if (screenWakeLock != null && screenWakeLock.isHeld()) screenWakeLock.release();
    }

    private void writeStatus(String state, String message) {
        try {
            File audit = calibrationAuditRoot();
            JSONObject value = new JSONObject()
                    .put("state", state)
                    .put("message", message)
                    .put("updated_at_epoch_ms", System.currentTimeMillis())
                    .put("updated_at_elapsed_realtime_ns", SystemClock.elapsedRealtimeNanos())
                    .put("artifact", directory == null
                            ? JSONObject.NULL : directory.getAbsolutePath());
            SessionArtifacts.writeJson(new File(audit, "status.json"), value);
        } catch (IOException | JSONException error) {
            Log.e(TAG, "Calibration status write failed", error);
        }
    }

    private void writeCalibrationReport(
            File artifact,
            String result,
            String error,
            VideoImuCalibration calibration,
            CalibrationAnalyzer.Analysis analysis) throws IOException {
        try {
            JSONObject report = new JSONObject()
                    .put("schema", "rootlens.mentra.calibration_run.v1")
                    .put("result", result)
                    .put("error", error == null ? JSONObject.NULL : error)
                    .put("completed_at_epoch_ms", System.currentTimeMillis())
                    .put("calibration", calibration == null
                            ? JSONObject.NULL : CalibrationStore.auditJson(calibration));
            if (analysis != null) {
                report.put("capture_duration_ns", analysis.captureDurationNs)
                        .put("visual_sample_count", analysis.visualSampleCount)
                        .put("gyro_sample_count", analysis.gyroSampleCount)
                        .put("full_sequence_offset_ns", analysis.result.fullSequenceOffsetNs)
                        .put("median_window_correlation", analysis.result.medianWindowCorrelation);
            }
            SessionArtifacts.writeJson(new File(artifact, "calibration_report.json"), report);
        } catch (JSONException jsonError) {
            throw new IOException("Calibration report construction failed", jsonError);
        }
    }

    private File calibrationAuditRoot() throws IOException {
        File root = new File(getExternalFilesDir(null), "calibration");
        if (!root.exists() && !root.mkdirs()) {
            throw new IOException("Cannot create calibration audit directory");
        }
        return root;
    }

    private boolean discardCalibrationArtifact(File artifact) {
        if (artifact == null || !artifact.getName().startsWith("calibration-")) return false;
        try {
            File recordings = new File(getExternalFilesDir(null), "recordings").getCanonicalFile();
            if (!recordings.equals(artifact.getCanonicalFile().getParentFile())) return false;
        } catch (IOException error) {
            return false;
        }
        return deleteRecursively(artifact);
    }

    private static boolean deleteRecursively(File target) {
        boolean success = true;
        if (target.isDirectory()) {
            File[] children = target.listFiles();
            if (children == null) return false;
            for (File child : children) success &= deleteRecursively(child);
        }
        return !target.exists() || (target.delete() && success);
    }

    private Notification notification(String text) {
        PendingIntent open = PendingIntent.getActivity(
                this,
                0,
                new Intent(this, MainActivity.class),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(this, AppContract.CHANNEL_ID)
                .setSmallIcon(android.R.drawable.presence_video_online)
                .setContentTitle("RootLens RGB/IMU calibration")
                .setContentText(text)
                .setOngoing(phase != Phase.SUCCEEDED && phase != Phase.FAILED)
                .setContentIntent(open)
                .build();
    }

    private void updateNotification(String text) {
        getSystemService(NotificationManager.class).notify(
                AppContract.CALIBRATION_NOTIFICATION_ID, notification(text));
    }

    private void submit(Runnable task) {
        try {
            serial.execute(task);
        } catch (RejectedExecutionException ignored) {
            Log.d(TAG, "Ignoring callback after calibration shutdown");
        }
    }
}

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
import android.os.StatFs;
import android.os.SystemClock;
import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.IOException;
import java.util.Date;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class CaptureService extends Service {
    private static final String TAG = "RootLensService";
    private static final long STORAGE_FIXED_RESERVE_BYTES = 512L * 1024L * 1024L;

    private final ExecutorService serial = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private CaptureEngine engine;
    private PowerManager.WakeLock wakeLock;
    private PowerManager.WakeLock screenWakeLock;
    private Runnable automaticStop;
    private long remainingSeconds;
    private int currentSegmentSeconds;
    private int bitrateBps;
    private boolean manualStopRequested;
    private boolean sessionActive;
    private boolean startFeedbackPlayed;

    @Override
    public void onCreate() {
        super.onCreate();
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel(
                AppContract.CHANNEL_ID, "RootLens capture", NotificationManager.IMPORTANCE_LOW));
        PowerManager power = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "RootLensMentra:capture");
        screenWakeLock = power.newWakeLock(
                PowerManager.FULL_WAKE_LOCK
                        | PowerManager.ACQUIRE_CAUSES_WAKEUP
                        | PowerManager.ON_AFTER_RELEASE,
                "RootLensMentra:camera-start");
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? AppContract.ACTION_STATUS : intent.getAction();
        startForeground(AppContract.NOTIFICATION_ID, notification("Preparing"));
        serial.execute(() -> handle(action, intent));
        return START_NOT_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        mainHandler.removeCallbacksAndMessages(null);
        serial.execute(() -> {
            manualStopRequested = true;
            if (engine != null) engine.stop();
        });
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        if (screenWakeLock != null && screenWakeLock.isHeld()) screenWakeLock.release();
        serial.shutdown();
        super.onDestroy();
    }

    private void handle(String action, Intent intent) {
        if (AppContract.ACTION_START.equals(action)) {
            startSession(intent);
        } else if (AppContract.ACTION_TOGGLE.equals(action)) {
            if (sessionActive) {
                stopCurrent(true);
            } else {
                Intent start = new Intent();
                start.putExtra(AppContract.EXTRA_DURATION_SECONDS, AppContract.MAX_SESSION_SECONDS);
                startSession(start);
            }
        } else if (AppContract.ACTION_STOP.equals(action)) {
            stopCurrent(true);
        } else if (AppContract.ACTION_PROBE.equals(action)) {
            probe();
        } else {
            writeStatus("idle", "Status requested", engine == null ? null : engine.directory());
            updateNotification(engine == null ? "Idle" : "Recording");
            if (engine == null) stopForegroundAndSelf();
        }
    }

    private void startSession(Intent intent) {
        if (engine != null) {
            writeStatus("recording", "Start ignored because a capture is already active", engine.directory());
            return;
        }
        int requested = intent == null ? 30
                : intent.getIntExtra(AppContract.EXTRA_DURATION_SECONDS, 30);
        requested = Math.max(1, Math.min(AppContract.MAX_SESSION_SECONDS, requested));
        bitrateBps = intent == null ? AppContract.DEFAULT_BITRATE_BPS
                : intent.getIntExtra(AppContract.EXTRA_BITRATE_BPS, AppContract.DEFAULT_BITRATE_BPS);
        bitrateBps = Math.max(2_000_000, Math.min(12_000_000, bitrateBps));

        File root = recordingsRoot();
        long estimatedBytes = Math.round(requested * (bitrateBps / 8.0) * 1.20)
                + STORAGE_FIXED_RESERVE_BYTES;
        long availableBytes = new StatFs(root.getAbsolutePath()).getAvailableBytes();
        if (availableBytes < estimatedBytes) {
            IOException error = new IOException("Insufficient storage: need " + estimatedBytes
                    + " bytes including margin, available " + availableBytes);
            writeStatus("failed", error.getMessage(), null);
            updateNotification("Storage check failed");
            stopForegroundAndSelf();
            return;
        }

        remainingSeconds = requested;
        manualStopRequested = false;
        sessionActive = true;
        startFeedbackPlayed = false;
        if (!wakeLock.isHeld()) wakeLock.acquire(AppContract.MAX_SESSION_SECONDS * 1000L + 60_000L);
        wakeCameraAccessPath();
        writeStatus("starting", "Starting " + requested + " second session", null);
        mainHandler.postDelayed(() -> serial.execute(this::startNextSegment), 750L);
    }

    private void startNextSegment() {
        if (manualStopRequested || remainingSeconds <= 0) {
            finishSession("complete", "Capture session complete");
            return;
        }
        currentSegmentSeconds = (int) Math.min(remainingSeconds, AppContract.MAX_CLIP_SECONDS);
        CaptureEngine[] holder = new CaptureEngine[1];
        CaptureEngine next = new CaptureEngine(
                this, currentSegmentSeconds, bitrateBps, new CaptureEngine.Listener() {
                    @Override
                    public void onStarted(File directory, DeviceProbe.Snapshot probe) {
                        serial.execute(() -> segmentStarted(holder[0], directory, probe));
                    }

                    @Override
                    public void onCompleted(File directory) {
                        serial.execute(() -> segmentCompleted(holder[0], directory));
                    }

                    @Override
                    public void onFailed(File directory, Throwable error) {
                        serial.execute(() -> segmentFailed(holder[0], directory, error));
                    }
                });
        holder[0] = next;
        engine = next;
        try {
            next.start();
        } catch (IOException | CameraAccessException | RuntimeException error) {
            engine = null;
            writeStatus("failed", error.toString(), next.directory());
            Log.e(TAG, "Capture start failed", error);
            finishSession("failed", error.getMessage());
        }
    }

    private void segmentStarted(
            CaptureEngine source, File directory, DeviceProbe.Snapshot probe) {
        if (engine != source) return;
        String guarantee = probe.androidElapsedRealtimeComparable()
                ? "HAL REALTIME / physical source unverified"
                : "HAL UNKNOWN / empirical mapping only";
        writeStatus("recording", "Recording " + currentSegmentSeconds + "s segment; " + guarantee, directory);
        updateNotification("Recording · " + guarantee);
        if (!startFeedbackPlayed) {
            startFeedbackPlayed = true;
            CaptureFeedback.started(this);
        }
        automaticStop = () -> serial.execute(() -> stopCurrent(false));
        mainHandler.postDelayed(automaticStop, currentSegmentSeconds * 1000L);
    }

    private void stopCurrent(boolean manual) {
        if (manual) manualStopRequested = true;
        cancelAutomaticStop();
        if (engine == null) {
            finishSession("idle", manual ? "No active capture" : "Capture already stopped");
            return;
        }
        writeStatus("finalizing", "Finalizing MP4 and timestamp sidecars", engine.directory());
        updateNotification("Finalizing");
        engine.stop();
    }

    private void segmentCompleted(CaptureEngine source, File directory) {
        if (engine != source) return;
        cancelAutomaticStop();
        engine = null;
        remainingSeconds = Math.max(0, remainingSeconds - currentSegmentSeconds);
        writeStatus("segment_complete", "Accepted local segment; " + remainingSeconds + "s remaining", directory);
        if (manualStopRequested || remainingSeconds <= 0) {
            finishSession("complete", manualStopRequested ? "Capture stopped by request" : "Capture session complete");
        } else {
            startNextSegment();
        }
    }

    private void segmentFailed(CaptureEngine source, File directory, Throwable error) {
        if (engine != source) return;
        cancelAutomaticStop();
        engine = null;
        Log.e(TAG, "Capture failed", error);
        writeStatus("failed", error.toString(), directory);
        finishSession("failed", error.getMessage());
    }

    private void probe() {
        if (engine != null) {
            writeStatus("recording", "Probe skipped during recording", engine.directory());
            return;
        }
        try {
            DeviceProbe.Snapshot snapshot = DeviceProbe.inspect(this);
            File probes = new File(recordingsRoot(), "probes");
            if (!probes.exists() && !probes.mkdirs()) throw new IOException("Cannot create probes directory");
            File output = new File(probes, "probe-" + System.currentTimeMillis() + ".json");
            JSONObject value = new JSONObject(snapshot.json.toString());
            value.put("probed_at_elapsed_realtime_ns", SystemClock.elapsedRealtimeNanos());
            SessionArtifacts.writeJson(output, value);
            String summary = snapshot.androidElapsedRealtimeComparable()
                    ? "HAL REALTIME; physical clock source remains unverified"
                    : "HAL UNKNOWN; only an empirical cross-timebase mapping is available";
            writeStatus("probe_complete", summary, output);
            updateNotification(summary);
        } catch (IOException | JSONException error) {
            writeStatus("failed", "Probe failed: " + error, null);
            updateNotification("Probe failed");
        }
        stopForegroundAndSelf();
    }

    private void finishSession(String state, String message) {
        boolean wasActive = sessionActive;
        sessionActive = false;
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        if (screenWakeLock != null && screenWakeLock.isHeld()) screenWakeLock.release();
        writeStatus(state, message == null ? state : message, null);
        updateNotification(message == null ? state : message);
        if ("failed".equals(state)) {
            CaptureFeedback.failed(this);
        } else if (wasActive && ("complete".equals(state) || "idle".equals(state))) {
            CaptureFeedback.stopped(this);
            if ("complete".equals(state)) {
                Intent upload = new Intent(this, UploadService.class)
                        .setAction(AppContract.ACTION_UPLOAD);
                startForegroundService(upload);
            }
        }
        stopForegroundAndSelf();
    }

    @SuppressWarnings("deprecation")
    private void wakeCameraAccessPath() {
        if (!screenWakeLock.isHeld()) screenWakeLock.acquire(10_000L);
        Intent foreground = new Intent(this, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        try {
            startActivity(foreground);
        } catch (RuntimeException error) {
            Log.w(TAG, "Could not bring capture activity to foreground", error);
        }
    }

    private void cancelAutomaticStop() {
        if (automaticStop != null) {
            mainHandler.removeCallbacks(automaticStop);
            automaticStop = null;
        }
    }

    private File recordingsRoot() {
        File root = new File(getExternalFilesDir(null), "recordings");
        if (!root.exists()) root.mkdirs();
        return root;
    }

    private void writeStatus(String state, String message, File artifact) {
        try {
            JSONObject status = new JSONObject()
                    .put("state", state)
                    .put("message", message == null ? JSONObject.NULL : message)
                    .put("updated_at_epoch_ms", System.currentTimeMillis())
                    .put("updated_at_elapsed_realtime_ns", SystemClock.elapsedRealtimeNanos())
                    .put("remaining_seconds", remainingSeconds)
                    .put("artifact", artifact == null ? JSONObject.NULL : artifact.getAbsolutePath());
            SessionArtifacts.writeJson(new File(recordingsRoot(), "status.json"), status);
        } catch (IOException | JSONException error) {
            Log.e(TAG, "Status write failed", error);
        }
    }

    private Notification notification(String text) {
        Intent open = new Intent(this, MainActivity.class);
        PendingIntent pending = PendingIntent.getActivity(
                this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(this, AppContract.CHANNEL_ID)
                .setSmallIcon(android.R.drawable.presence_video_online)
                .setContentTitle("RootLens Mentra")
                .setContentText(text)
                .setOngoing(engine != null)
                .setContentIntent(pending)
                .build();
    }

    private void updateNotification(String text) {
        getSystemService(NotificationManager.class).notify(AppContract.NOTIFICATION_ID, notification(text));
    }

    private void stopForegroundAndSelf() {
        mainHandler.postDelayed(() -> {
            stopForeground(false);
            stopSelf();
        }, 1500);
    }
}

package io.rootlens.mentra;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
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
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;

public final class CaptureService extends Service {
    private static final String TAG = "RootLensService";
    private static final long STORAGE_FIXED_RESERVE_BYTES = 512L * 1024L * 1024L;
    private static final int MAX_CAMERA_OPEN_ATTEMPTS = 4;
    private static final long SESSION_WAKE_LOCK_TIMEOUT_MS =
            (AppContract.MAX_SESSION_SECONDS + 60L * 60L) * 1_000L;
    private static final String COMMAND_STATE = "capture_command_state";
    private static final String LAST_COMMAND_ID = "last_command_id";

    private final ExecutorService serial = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private CaptureSessionReducer.State state = CaptureSessionReducer.State.idle();
    private CaptureEngine engine;
    private long engineGeneration;
    private long cameraOpenAttemptGeneration;
    private int cameraOpenAttemptCount;
    private Runnable pendingOpen;
    private Runnable pendingTimeLimit;
    private Runnable pendingStorageCheck;
    private int bitrateBps = AppContract.DEFAULT_BITRATE_BPS;
    private PowerManager.WakeLock wakeLock;
    private PowerManager.WakeLock screenWakeLock;
    private SharedPreferences commandState;

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
        commandState = createDeviceProtectedStorageContext()
                .getSharedPreferences(COMMAND_STATE, MODE_PRIVATE);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Intent command = intent == null
                ? new Intent().setAction(AppContract.ACTION_STATUS)
                : new Intent(intent);
        startForeground(AppContract.NOTIFICATION_ID, notification("Preparing"));
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
        try {
            serial.execute(() -> {
                cancelOpen();
                cancelTimeLimit();
                cancelStorageCheck();
                CaptureEngine abandoned = engine;
                engine = null;
                engineGeneration = 0L;
                if (abandoned != null) abandoned.stop();
            });
        } catch (RejectedExecutionException ignored) {
        }
        releaseLocks();
        DeviceOperationGate.release(DeviceOperationGate.Owner.CAPTURE);
        serial.shutdown();
        super.onDestroy();
    }

    private void handle(Intent command) {
        if (!acceptCommand(command)) return;
        String action = command.getAction();
        if (AppContract.ACTION_START.equals(action)) {
            beginStart(command);
        } else if (AppContract.ACTION_TOGGLE.equals(action)) {
            if (state.phase == CaptureSessionReducer.Phase.IDLE) {
                Intent start = new Intent()
                        .putExtra(AppContract.EXTRA_DURATION_SECONDS, AppContract.MAX_SESSION_SECONDS);
                beginStart(start);
            } else if (state.isActive()) {
                dispatch(CaptureSessionReducer.Event.stop());
            }
        } else if (AppContract.ACTION_STOP.equals(action)) {
            if (state.isActive()) {
                dispatch(CaptureSessionReducer.Event.stop());
            } else {
                writeStatus("idle", "No active capture", null);
                updateNotification("No active capture");
                stopForegroundAndSelf();
            }
        } else if (AppContract.ACTION_PROBE.equals(action)) {
            probe();
        } else {
            publishState();
            if (!state.isActive()) stopForegroundAndSelf();
        }
    }

    private boolean acceptCommand(Intent command) {
        String commandId = command.getStringExtra(AppContract.EXTRA_COMMAND_ID);
        if (commandId == null) return true;
        if (commandId.equals(commandState.getString(LAST_COMMAND_ID, null))) {
            Log.i(TAG, "Ignoring duplicate capture command");
            if (state.isActive()) {
                publishState();
            } else {
                stopForegroundAndSelf();
            }
            return false;
        }
        if (!commandState.edit().putString(LAST_COMMAND_ID, commandId).commit()) {
            dispatch(CaptureSessionReducer.Event.preflightFailed(
                    "Could not durably record the physical capture command"));
            return false;
        }
        return true;
    }

    private void beginStart(Intent command) {
        if (state.phase != CaptureSessionReducer.Phase.IDLE) {
            publishState();
            return;
        }
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED
                || checkSelfPermission(Manifest.permission.RECORD_AUDIO)
                        != PackageManager.PERMISSION_GRANTED) {
            dispatch(CaptureSessionReducer.Event.preflightFailed(
                    "Camera and microphone permissions are required"));
            return;
        }
        if (!DeviceOperationGate.tryAcquire(DeviceOperationGate.Owner.CAPTURE)) {
            dispatch(CaptureSessionReducer.Event.preflightFailed(
                    "Another camera operation is active"));
            return;
        }
        int requested = command.getIntExtra(AppContract.EXTRA_DURATION_SECONDS, 30);
        requested = Math.max(1, Math.min(AppContract.MAX_SESSION_SECONDS, requested));
        int requestedBitrate = command.getIntExtra(
                AppContract.EXTRA_BITRATE_BPS, AppContract.DEFAULT_BITRATE_BPS);
        requestedBitrate = Math.max(2_000_000, Math.min(12_000_000, requestedBitrate));

        File root = recordingsRoot();
        int reservedSeconds = Math.min(requested, AppContract.STORAGE_PREFLIGHT_SECONDS);
        long estimatedBytes = Math.round(reservedSeconds * (requestedBitrate / 8.0) * 1.20)
                + STORAGE_FIXED_RESERVE_BYTES;
        long availableBytes = new StatFs(root.getAbsolutePath()).getAvailableBytes();
        if (availableBytes < estimatedBytes) {
            dispatch(CaptureSessionReducer.Event.preflightFailed(
                    "Insufficient storage: need " + estimatedBytes
                            + " bytes including margin, available " + availableBytes));
            return;
        }

        bitrateBps = requestedBitrate;
        acquireLocks();
        dispatch(CaptureSessionReducer.Event.start(requested));
    }

    private void dispatch(CaptureSessionReducer.Event event) {
        CaptureSessionReducer.Phase previousPhase = state.phase;
        CaptureSessionReducer.Transition transition = CaptureSessionReducer.reduce(state, event);
        if (transition.state == state && transition.effects.isEmpty()) return;
        state = transition.state;
        Log.i(TAG, previousPhase + " --" + event.type + "--> " + state.phase
                + " generation=" + state.generation);
        publishState();
        for (CaptureSessionReducer.Effect effect : transition.effects) {
            interpret(effect);
        }
    }

    private void interpret(CaptureSessionReducer.Effect effect) {
        switch (effect.type) {
            case ACKNOWLEDGE_START:
                CaptureFeedback.startReceived(this);
                break;
            case ACKNOWLEDGE_STOP:
                CaptureFeedback.stopReceived(this);
                break;
            case SCHEDULE_OPEN:
                scheduleOpen(effect.generation, effect.delayMs);
                break;
            case CANCEL_OPEN:
                cancelOpen();
                break;
            case OPEN_SEGMENT:
                openSegment(effect.generation);
                break;
            case SCHEDULE_TIME_LIMIT:
                scheduleTimeLimit(effect.generation, effect.delayMs);
                break;
            case CANCEL_TIME_LIMIT:
                cancelTimeLimit();
                break;
            case SCHEDULE_STORAGE_CHECK:
                scheduleStorageCheck(effect.generation, effect.delayMs);
                break;
            case CANCEL_STORAGE_CHECK:
                cancelStorageCheck();
                break;
            case STOP_SEGMENT:
                stopSegment(effect.generation);
                break;
            case FINISH_SUCCEEDED:
                finishSucceeded();
                break;
            case FINISH_FAILED:
                finishFailed();
                break;
            default:
                throw new IllegalStateException("Unhandled capture effect " + effect.type);
        }
    }

    private void scheduleOpen(long generation, long delayMs) {
        cancelOpen();
        wakeCameraAccessPath();
        Runnable[] callback = new Runnable[1];
        callback[0] = () -> submit(() -> {
            if (pendingOpen != callback[0]) return;
            pendingOpen = null;
            dispatch(CaptureSessionReducer.Event.openTimer(generation));
        });
        pendingOpen = callback[0];
        mainHandler.postDelayed(callback[0], delayMs);
    }

    private void cancelOpen() {
        if (pendingOpen == null) return;
        mainHandler.removeCallbacks(pendingOpen);
        pendingOpen = null;
    }

    private void openSegment(long generation) {
        if (state.phase != CaptureSessionReducer.Phase.OPENING
                || state.generation != generation) return;
        if (engine != null) {
            dispatch(CaptureSessionReducer.Event.segmentFailed(
                    generation, state.artifactPath, "Capture invariant violated: engine already exists"));
            return;
        }

        int attempt = nextCameraOpenAttempt(generation);
        CaptureEngine[] holder = new CaptureEngine[1];
        CaptureEngine next = new CaptureEngine(
                this, state.currentSegmentSeconds, bitrateBps, new CaptureEngine.Listener() {
                    @Override
                    public void onStarted(File directory, DeviceProbe.Snapshot probe) {
                        submit(() -> segmentStarted(holder[0], generation, directory, probe));
                    }

                    @Override
                    public void onCompleted(File directory) {
                        submit(() -> segmentCompleted(holder[0], generation, directory));
                    }

                    @Override
                    public void onFailed(File directory, Throwable error) {
                        submit(() -> segmentFailed(holder[0], generation, directory, error));
                    }
                });
        holder[0] = next;
        engine = next;
        engineGeneration = generation;
        try {
            next.start();
        } catch (IOException | CameraAccessException | RuntimeException error) {
            if (engine == next && engineGeneration == generation) {
                engine = null;
                engineGeneration = 0L;
                if (shouldRetryCameraOpen(error, attempt)) {
                    Log.w(TAG, "Camera access unavailable; waking foreground path and retrying "
                            + attempt + "/" + MAX_CAMERA_OPEN_ATTEMPTS, error);
                    dispatch(CaptureSessionReducer.Event.segmentOpenRetry(
                            generation,
                            path(next.directory()),
                            "Camera access retry " + attempt + "/" + MAX_CAMERA_OPEN_ATTEMPTS));
                } else {
                    Log.e(TAG, "Capture start failed", error);
                    dispatch(CaptureSessionReducer.Event.segmentFailed(
                            generation, path(next.directory()), error.toString()));
                }
            }
        }
    }

    private int nextCameraOpenAttempt(long generation) {
        if (cameraOpenAttemptGeneration != generation) {
            cameraOpenAttemptGeneration = generation;
            cameraOpenAttemptCount = 0;
        }
        return ++cameraOpenAttemptCount;
    }

    private static boolean shouldRetryCameraOpen(Throwable error, int attempt) {
        return attempt < MAX_CAMERA_OPEN_ATTEMPTS
                && error instanceof CameraAccessException
                && ((CameraAccessException) error).getReason()
                == CameraAccessException.CAMERA_DISABLED;
    }

    private void segmentStarted(
            CaptureEngine source,
            long generation,
            File directory,
            DeviceProbe.Snapshot probe) {
        if (!owns(source, generation)) return;
        String guarantee = probe.androidElapsedRealtimeComparable()
                ? "HAL REALTIME / physical source unverified"
                : "HAL UNKNOWN / empirical mapping only";
        dispatch(CaptureSessionReducer.Event.segmentStarted(
                generation,
                path(directory),
                "Recording " + state.currentSegmentSeconds + "s segment; " + guarantee));
    }

    private void segmentCompleted(CaptureEngine source, long generation, File directory) {
        if (!owns(source, generation)) return;
        engine = null;
        engineGeneration = 0L;
        dispatch(CaptureSessionReducer.Event.segmentCompleted(generation, path(directory)));
    }

    private void segmentFailed(
            CaptureEngine source, long generation, File directory, Throwable error) {
        if (!owns(source, generation)) return;
        engine = null;
        engineGeneration = 0L;
        Log.e(TAG, "Capture failed", error);
        dispatch(CaptureSessionReducer.Event.segmentFailed(
                generation, path(directory), error == null ? "Capture failed" : error.toString()));
    }

    private boolean owns(CaptureEngine source, long generation) {
        return engine == source && engineGeneration == generation;
    }

    private void scheduleTimeLimit(long generation, long delayMs) {
        cancelTimeLimit();
        Runnable[] callback = new Runnable[1];
        callback[0] = () -> submit(() -> {
            if (pendingTimeLimit != callback[0]) return;
            pendingTimeLimit = null;
            dispatch(CaptureSessionReducer.Event.timeLimitReached(generation));
        });
        pendingTimeLimit = callback[0];
        mainHandler.postDelayed(callback[0], delayMs);
    }

    private void cancelTimeLimit() {
        if (pendingTimeLimit == null) return;
        mainHandler.removeCallbacks(pendingTimeLimit);
        pendingTimeLimit = null;
    }

    private void scheduleStorageCheck(long generation, long delayMs) {
        cancelStorageCheck();
        Runnable[] callback = new Runnable[1];
        callback[0] = () -> submit(() -> {
            if (pendingStorageCheck != callback[0]) return;
            pendingStorageCheck = null;
            if (state.phase != CaptureSessionReducer.Phase.RECORDING
                    || state.generation != generation) return;
            long availableBytes = new StatFs(recordingsRoot().getAbsolutePath()).getAvailableBytes();
            if (availableBytes <= STORAGE_FIXED_RESERVE_BYTES) {
                dispatch(CaptureSessionReducer.Event.storageLimitReached(generation));
            } else {
                scheduleStorageCheck(
                        generation, CaptureSessionReducer.STORAGE_CHECK_INTERVAL_MS);
            }
        });
        pendingStorageCheck = callback[0];
        mainHandler.postDelayed(callback[0], delayMs);
    }

    private void cancelStorageCheck() {
        if (pendingStorageCheck == null) return;
        mainHandler.removeCallbacks(pendingStorageCheck);
        pendingStorageCheck = null;
    }

    private void stopSegment(long generation) {
        if (!owns(engine, generation) || engine == null) {
            dispatch(CaptureSessionReducer.Event.segmentFailed(
                    generation, state.artifactPath, "Capture invariant violated: no engine to stop"));
            return;
        }
        engine.stop();
    }

    private void finishSucceeded() {
        releaseLocks();
        DeviceOperationGate.release(DeviceOperationGate.Owner.CAPTURE);
        stopForegroundAndSelf();
    }

    private void finishFailed() {
        releaseLocks();
        DeviceOperationGate.release(DeviceOperationGate.Owner.CAPTURE);
        CaptureFeedback.failed(this);
        stopForegroundAndSelf();
    }

    private void probe() {
        if (state.isActive()) {
            publishState();
            return;
        }
        try {
            DeviceProbe.Snapshot snapshot = DeviceProbe.inspect(this);
            File probes = new File(recordingsRoot(), "probes");
            if (!probes.exists() && !probes.mkdirs()) {
                throw new IOException("Cannot create probes directory");
            }
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

    private void publishState() {
        File artifact = state.artifactPath == null ? null : new File(state.artifactPath);
        writeStatus(statusName(state.phase), state.message, artifact);
        updateNotification(state.message == null ? statusName(state.phase) : state.message);
    }

    private static String statusName(CaptureSessionReducer.Phase phase) {
        switch (phase) {
            case START_PENDING:
            case OPENING:
                return "starting";
            case RECORDING:
                return "recording";
            case FINALIZING:
                return "finalizing";
            case SUCCEEDED:
                return "complete";
            case FAILED:
                return "failed";
            case IDLE:
            default:
                return "idle";
        }
    }

    @SuppressWarnings("deprecation")
    private void acquireLocks() {
        if (!wakeLock.isHeld()) {
            wakeLock.acquire(SESSION_WAKE_LOCK_TIMEOUT_MS);
        }
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

    private void releaseLocks() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        if (screenWakeLock != null && screenWakeLock.isHeld()) screenWakeLock.release();
    }

    private File recordingsRoot() {
        File root = new File(getExternalFilesDir(null), "recordings");
        if (!root.exists()) root.mkdirs();
        return root;
    }

    private void writeStatus(String status, String message, File artifact) {
        try {
            JSONObject value = new JSONObject()
                    .put("state", status)
                    .put("phase", state.phase.name())
                    .put("generation", state.generation)
                    .put("message", message == null ? JSONObject.NULL : message)
                    .put("updated_at_epoch_ms", System.currentTimeMillis())
                    .put("updated_at_elapsed_realtime_ns", SystemClock.elapsedRealtimeNanos())
                    .put("remaining_seconds", state.remainingSeconds)
                    .put("completed_clip_count", state.completedClipCount)
                    .put("logical_session_active", state.isActive())
                    .put("storage_stop_reserve_bytes", STORAGE_FIXED_RESERVE_BYTES)
                    .put("artifact", artifact == null
                            ? JSONObject.NULL : artifact.getAbsolutePath());
            SessionArtifacts.writeJson(new File(recordingsRoot(), "status.json"), value);
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
                .setOngoing(state.isActive())
                .setContentIntent(pending)
                .build();
    }

    private void updateNotification(String text) {
        getSystemService(NotificationManager.class).notify(
                AppContract.NOTIFICATION_ID, notification(text));
    }

    private void stopForegroundAndSelf() {
        stopForeground(false);
        stopSelf();
    }

    private void submit(Runnable task) {
        try {
            serial.execute(task);
        } catch (RejectedExecutionException ignored) {
            Log.d(TAG, "Ignoring callback after service shutdown");
        }
    }

    private static String path(File file) {
        return file == null ? null : file.getAbsolutePath();
    }
}

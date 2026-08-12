package io.rootlens.mentra;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

public final class FieldControlService extends Service {
    private static final String TAG = "RootLensFieldControl";
    private static final String TOUCH_LONG_PRESS = "Touch event - Type: long_press (3)";
    private static final long DEBOUNCE_MS = 1_500L;

    private final ExecutorService reader = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final AtomicBoolean readerStarted = new AtomicBoolean();
    private volatile Process logcat;
    private long lastToggleElapsedMs;

    @Override
    public void onCreate() {
        super.onCreate();
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel(
                AppContract.FIELD_CONTROL_CHANNEL_ID,
                "RootLens field controls",
                NotificationManager.IMPORTANCE_LOW));
        startForeground(AppContract.FIELD_CONTROL_NOTIFICATION_ID, notification(hasLogPermission()));
        startReaderIfPermitted();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        startReaderIfPermitted();
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        Process process = logcat;
        if (process != null) process.destroy();
        reader.shutdownNow();
        mainHandler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }

    private void readMentraControls() {
        while (!Thread.currentThread().isInterrupted()) {
            try {
                Process process = new ProcessBuilder(
                        "logcat", "-v", "raw", "-T", "1", "-s", "K900CommandHandler:I", "*:S")
                        .redirectErrorStream(true)
                        .start();
                logcat = process;
                try (BufferedReader lines = new BufferedReader(new InputStreamReader(
                        process.getInputStream(), StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = lines.readLine()) != null) {
                        if (line.contains(TOUCH_LONG_PRESS)) onLongPress();
                    }
                }
                int exitCode = process.waitFor();
                Log.w(TAG, "Mentra control reader exited with " + exitCode);
            } catch (IOException error) {
                Log.e(TAG, "READ_LOGS permission is required for offline field controls", error);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                return;
            } finally {
                logcat = null;
            }
            if (Thread.currentThread().isInterrupted()) return;
            SystemClock.sleep(2_000L);
        }
    }

    private void startReaderIfPermitted() {
        boolean permitted = hasLogPermission();
        getSystemService(NotificationManager.class).notify(
                AppContract.FIELD_CONTROL_NOTIFICATION_ID, notification(permitted));
        if (permitted && readerStarted.compareAndSet(false, true)) {
            reader.execute(this::readMentraControls);
        }
    }

    private boolean hasLogPermission() {
        return checkSelfPermission("android.permission.READ_LOGS")
                == PackageManager.PERMISSION_GRANTED;
    }

    private synchronized void onLongPress() {
        long now = SystemClock.elapsedRealtime();
        if (now - lastToggleElapsedMs < DEBOUNCE_MS) return;
        lastToggleElapsedMs = now;
        Log.i(TAG, "Mentra touch long-press received; toggling capture");
        mainHandler.post(this::bringActivityForwardAndToggle);
    }

    private void bringActivityForwardAndToggle() {
        Intent toggle = new Intent(this, MainActivity.class)
                .setAction(AppContract.ACTION_TOGGLE)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                        | Intent.FLAG_ACTIVITY_SINGLE_TOP
                        | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        try {
            startActivity(toggle);
        } catch (RuntimeException error) {
            Log.e(TAG, "Could not open RootLens capture activity", error);
            CaptureFeedback.failed();
        }
    }

    private Notification notification(boolean ready) {
        Intent open = new Intent(this, MainActivity.class)
                .setAction(AppContract.ACTION_FIELD_READY);
        PendingIntent pending = PendingIntent.getActivity(
                this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(this, AppContract.FIELD_CONTROL_CHANNEL_ID)
                .setSmallIcon(android.R.drawable.presence_video_online)
                .setContentTitle(ready
                        ? "RootLens field controls ready"
                        : "RootLens field controls need setup")
                .setContentText(ready
                        ? "Long-press the touch surface to start or stop"
                        : "Grant READ_LOGS from the setup computer")
                .setOngoing(true)
                .setContentIntent(pending)
                .build();
    }
}

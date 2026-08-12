package io.rootlens.mentra;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.IBinder;
import android.os.SystemClock;
import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class AccountProvisioningService extends Service {
    private static final String TAG = "RootLensProvision";
    private static final String DIRECTORY = "provisioning";
    private static final String INPUT_FILE = "account.json";
    private static final String STATUS_FILE = "status.json";

    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    @Override
    public void onCreate() {
        super.onCreate();
        getSystemService(NotificationManager.class).createNotificationChannel(
                new NotificationChannel(
                        AppContract.CHANNEL_ID,
                        "RootLens capture",
                        NotificationManager.IMPORTANCE_LOW));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || !AppContract.ACTION_PROVISION_ACCOUNT.equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }
        startForeground(AppContract.PROVISION_NOTIFICATION_ID, notification("Signing in"));
        worker.execute(this::provision);
        return START_NOT_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        worker.shutdown();
        super.onDestroy();
    }

    private void provision() {
        File directory = new File(getExternalFilesDir(null), DIRECTORY);
        File input = new File(directory, INPUT_FILE);
        String loginId = "";
        try {
            JSONObject credentials = new JSONObject(readSmallFile(input));
            loginId = credentials.optString("login_id", "").trim();
            String password = credentials.optString("password", "");
            if (!input.delete()) Log.w(TAG, "Could not delete provisioning input immediately");
            if (!loginId.matches("[a-z0-9_-]{3,32}") || password.isEmpty()) {
                throw new IOException("Provisioning credentials are invalid");
            }
            new RootLensAuth(this).login(loginId, password);
            writeStatus(directory, "signed_in", loginId, null);
            updateNotification("Signed in as " + loginId);
        } catch (IOException | JSONException error) {
            if (input.exists() && !input.delete()) {
                Log.w(TAG, "Could not delete failed provisioning input");
            }
            Log.e(TAG, "Account provisioning failed", error);
            writeStatus(directory, "error", loginId, error.getMessage());
            updateNotification("Sign-in failed");
            CaptureFeedback.failed(this);
        } finally {
            stopForeground(false);
            stopSelf();
        }
    }

    private void writeStatus(File directory, String state, String loginId, String error) {
        try {
            if (!directory.exists() && !directory.mkdirs()) {
                throw new IOException("Cannot create provisioning directory");
            }
            JSONObject status = new JSONObject()
                    .put("state", state)
                    .put("login_id", loginId)
                    .put("updated_at_epoch_ms", System.currentTimeMillis())
                    .put("updated_at_elapsed_realtime_ns", SystemClock.elapsedRealtimeNanos())
                    .put("error", error == null ? JSONObject.NULL : error);
            SessionArtifacts.writeJson(new File(directory, STATUS_FILE), status);
        } catch (IOException | JSONException writeError) {
            Log.e(TAG, "Could not write provisioning status", writeError);
        }
    }

    private static String readSmallFile(File file) throws IOException {
        if (!file.isFile()) throw new IOException("Provisioning input is missing");
        if (file.length() > 16 * 1024L) throw new IOException("Provisioning input is too large");
        try (InputStream input = new FileInputStream(file)) {
            return RootLensAuth.readBody(input);
        }
    }

    private Notification notification(String text) {
        PendingIntent open = PendingIntent.getActivity(
                this, 0, new Intent(this, MainActivity.class),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(this, AppContract.CHANNEL_ID)
                .setSmallIcon(android.R.drawable.stat_sys_upload_done)
                .setContentTitle("RootLens account setup")
                .setContentText(text)
                .setOngoing(true)
                .setContentIntent(open)
                .build();
    }

    private void updateNotification(String text) {
        getSystemService(NotificationManager.class).notify(
                AppContract.PROVISION_NOTIFICATION_ID, notification(text));
    }
}

package io.rootlens.mentra;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.os.IBinder;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class UploadService extends Service {
    private static final String TAG = "RootLensUpload";
    private static final int MAX_PUT_ATTEMPTS = 4;
    private static final long[] RETRY_DELAYS_MS = {2_000L, 5_000L, 15_000L};
    private static final String[] UPLOAD_FILES = {
            "rgb.mp4", "frames.jsonl", "imu.jsonl", "metadata.json"
    };

    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private RootLensAuth auth;

    @Override
    public void onCreate() {
        super.onCreate();
        auth = new RootLensAuth(this);
        getSystemService(NotificationManager.class).createNotificationChannel(new NotificationChannel(
                AppContract.CHANNEL_ID, "RootLens capture", NotificationManager.IMPORTANCE_LOW));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        startForeground(AppContract.UPLOAD_NOTIFICATION_ID, notification("Scanning local clips", 0, 0));
        worker.execute(this::uploadPending);
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

    private void uploadPending() {
        File root = new File(getExternalFilesDir(null), "recordings");
        File[] candidates = root.listFiles(file -> file.isDirectory() && file.getName().startsWith("rec-"));
        if (candidates == null) candidates = new File[0];
        Arrays.sort(candidates, Comparator.comparing(File::getName));
        ArrayList<File> pending = new ArrayList<>();
        for (File candidate : candidates) {
            if (hasRequiredFiles(candidate) && !isUploaded(candidate)) pending.add(candidate);
        }
        if (pending.isEmpty()) {
            finish("No pending clips");
            return;
        }
        if (!auth.hasSession()) {
            finish("Sign in before upload");
            return;
        }
        if (!hasValidatedWifi()) {
            UploadRetryJobService.schedule(this);
            CaptureFeedback.uploadPaused(this);
            finish("Waiting for Wi-Fi");
            return;
        }

        CaptureFeedback.uploadStarted(this);
        int completed = 0;
        for (File directory : pending) {
            try {
                uploadClip(directory, completed, pending.size());
                completed++;
            } catch (Throwable error) {
                Log.e(TAG, "Upload failed for " + directory, error);
                writeUploadState(directory, "error", error.getMessage(),
                        jsonArray(uploadedFiles(directory)));
                if (hasValidatedWifi()) {
                    CaptureFeedback.errorTone(this);
                } else {
                    UploadRetryJobService.schedule(this);
                    CaptureFeedback.uploadPaused(this);
                }
                finish("Upload failed · " + directory.getName());
                return;
            }
        }
        UploadRetryJobService.cancel(this);
        CaptureFeedback.uploadComplete(this);
        finish("Uploaded " + completed + " clip" + (completed == 1 ? "" : "s"));
    }

    private void uploadClip(File directory, int completedClips, int totalClips)
            throws IOException, JSONException {
        String contentHash = readSmallFile(new File(directory, "content_hash.txt")).trim();
        if (!contentHash.matches("[0-9a-f]{64}")) throw new IOException("Invalid content hash");
        Set<String> alreadyUploaded = uploadedFiles(directory);
        JSONObject presigned = postJson(
                RootLensAuth.trimTrailingSlash(BuildConfig.ROOTLENS_SERVER_URL) + "/api/v1/raw-uploads",
                new JSONObject().put("contentHash", contentHash).put("recordingConfig", "mentra"));
        JSONObject targets = presigned.getJSONObject("files");
        JSONArray completedFiles = new JSONArray();
        for (String name : UPLOAD_FILES) if (alreadyUploaded.contains(name)) completedFiles.put(name);

        for (int fileIndex = 0; fileIndex < UPLOAD_FILES.length; fileIndex++) {
            String name = UPLOAD_FILES[fileIndex];
            if (alreadyUploaded.contains(name)) continue;
            File source = new File(directory, name);
            JSONObject target = targets.optJSONObject(name);
            if (target == null) throw new IOException("Server did not presign required file " + name);
            updateNotification(
                    "Uploading " + name + " · clip " + (completedClips + 1) + "/" + totalClips,
                    fileIndex, UPLOAD_FILES.length);
            putWithRetry(source, target.getString("url"), target.getString("contentType"));
            completedFiles.put(name);
            writeUploadState(directory, "uploading", null, completedFiles);
        }

        JSONObject metadata = new JSONObject(readSmallFile(new File(directory, "metadata.json")));
        JSONObject deviceProbe = metadata.optJSONObject("device_probe");
        File video = new File(directory, "rgb.mp4");
        JSONObject registration = new JSONObject()
                .put("contentHash", contentHash)
                .put("contentSize", video.length())
                .put("recordingConfig", "mentra")
                .put("deviceModel", deviceProbe == null
                        ? "Mentra Live" : deviceProbe.optString("device_model", "Mentra Live"));
        long actualDurationMs = metadata.optLong("actual_duration_ms", 0);
        if (actualDurationMs > 0) registration.put("durationMs", actualDurationMs);
        postJson(RootLensAuth.trimTrailingSlash(BuildConfig.ROOTLENS_SERVER_URL) + "/api/clips",
                registration);
        writeUploadState(directory, "uploaded", null, completedFiles);
    }

    private JSONObject postJson(String endpoint, JSONObject body) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(endpoint).openConnection();
        connection.setConnectTimeout(20_000);
        connection.setReadTimeout(30_000);
        connection.setRequestMethod("POST");
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "application/json");
        connection.setRequestProperty("Authorization", "Bearer " + auth.accessToken());
        byte[] payload = body.toString().getBytes(StandardCharsets.UTF_8);
        connection.setFixedLengthStreamingMode(payload.length);
        try (OutputStream output = connection.getOutputStream()) {
            output.write(payload);
        }
        int status = connection.getResponseCode();
        String response = RootLensAuth.readBody(status >= 200 && status < 300
                ? connection.getInputStream() : connection.getErrorStream());
        connection.disconnect();
        if (status < 200 || status >= 300) {
            throw new IOException("POST " + endpoint + " returned " + status + ": " + truncate(response));
        }
        try {
            return new JSONObject(response);
        } catch (JSONException error) {
            throw new IOException("POST " + endpoint + " returned invalid JSON", error);
        }
    }

    private static void putWithRetry(File source, String endpoint, String contentType) throws IOException {
        IOException lastError = null;
        for (int attempt = 0; attempt < MAX_PUT_ATTEMPTS; attempt++) {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(endpoint).openConnection();
                connection.setConnectTimeout(30_000);
                connection.setReadTimeout(60_000);
                connection.setRequestMethod("PUT");
                connection.setDoOutput(true);
                connection.setFixedLengthStreamingMode(source.length());
                connection.setRequestProperty("Content-Type", contentType);
                byte[] buffer = new byte[1024 * 1024];
                try (InputStream input = new BufferedInputStream(new FileInputStream(source), buffer.length);
                     OutputStream output = new BufferedOutputStream(connection.getOutputStream(), buffer.length)) {
                    int count;
                    while ((count = input.read(buffer)) >= 0) {
                        if (count > 0) output.write(buffer, 0, count);
                    }
                }
                int status = connection.getResponseCode();
                String response = RootLensAuth.readBody(status >= 200 && status < 300
                        ? connection.getInputStream() : connection.getErrorStream());
                if (status >= 200 && status < 300) return;
                lastError = new IOException("R2 PUT " + source.getName() + " returned " + status
                        + ": " + truncate(response));
                if (status < 500) throw new NonRetryableUploadException(lastError.getMessage());
            } catch (NonRetryableUploadException error) {
                throw error;
            } catch (IOException error) {
                lastError = error;
            } finally {
                if (connection != null) connection.disconnect();
            }
            if (attempt + 1 < MAX_PUT_ATTEMPTS) {
                try {
                    Thread.sleep(RETRY_DELAYS_MS[attempt]);
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    throw new IOException("Upload retry interrupted", interrupted);
                }
            }
        }
        throw lastError == null ? new IOException("R2 PUT failed") : lastError;
    }

    private static boolean hasRequiredFiles(File directory) {
        if (!new File(directory, "content_hash.txt").isFile()) return false;
        for (String name : UPLOAD_FILES) if (!new File(directory, name).isFile()) return false;
        return true;
    }

    private static boolean isUploaded(File directory) {
        File state = new File(directory, "upload_state.json");
        if (!state.isFile()) return false;
        try {
            return "uploaded".equals(new JSONObject(readSmallFile(state)).optString("state"));
        } catch (IOException | JSONException ignored) {
            return false;
        }
    }

    private static Set<String> uploadedFiles(File directory) {
        Set<String> result = new HashSet<>();
        File state = new File(directory, "upload_state.json");
        if (!state.isFile()) return result;
        try {
            JSONArray names = new JSONObject(readSmallFile(state)).optJSONArray("uploaded_files");
            if (names != null) for (int index = 0; index < names.length(); index++) {
                result.add(names.getString(index));
            }
        } catch (IOException | JSONException ignored) {
        }
        return result;
    }

    private static void writeUploadState(
            File directory, String state, String error, JSONArray uploadedFiles) {
        try {
            JSONObject value = new JSONObject()
                    .put("state", state)
                    .put("updated_at_epoch_ms", System.currentTimeMillis())
                    .put("uploaded_files", uploadedFiles)
                    .put("error", error == null ? JSONObject.NULL : error);
            SessionArtifacts.writeJson(new File(directory, "upload_state.json"), value);
        } catch (IOException | JSONException writeError) {
            Log.e(TAG, "Could not write upload checkpoint", writeError);
        }
    }

    private static String readSmallFile(File file) throws IOException {
        if (!file.isFile()) throw new IOException("Missing file " + file);
        if (file.length() > 2 * 1024 * 1024) throw new IOException("Refusing to read large JSON file " + file);
        try (InputStream input = new FileInputStream(file)) {
            return RootLensAuth.readBody(input);
        }
    }

    private Notification notification(String text, int progress, int max) {
        PendingIntent open = PendingIntent.getActivity(
                this, 0, new Intent(this, MainActivity.class),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder = new Notification.Builder(this, AppContract.CHANNEL_ID)
                .setSmallIcon(android.R.drawable.stat_sys_upload)
                .setContentTitle("RootLens Mentra upload")
                .setContentText(text)
                .setOngoing(true)
                .setContentIntent(open);
        if (max > 0) builder.setProgress(max, progress, false);
        return builder.build();
    }

    private void updateNotification(String text, int progress, int max) {
        getSystemService(NotificationManager.class).notify(
                AppContract.UPLOAD_NOTIFICATION_ID, notification(text, progress, max));
    }

    private void finish(String message) {
        getSystemService(NotificationManager.class).notify(
                AppContract.UPLOAD_NOTIFICATION_ID, notification(message, 0, 0));
        stopForeground(false);
        stopSelf();
    }

    private static String truncate(String value) {
        return value.length() <= 300 ? value : value.substring(0, 300);
    }

    private static JSONArray jsonArray(Set<String> values) {
        JSONArray result = new JSONArray();
        for (String value : values) result.put(value);
        return result;
    }

    private boolean hasValidatedWifi() {
        ConnectivityManager connectivity = getSystemService(ConnectivityManager.class);
        NetworkCapabilities capabilities = connectivity.getNetworkCapabilities(
                connectivity.getActiveNetwork());
        return capabilities != null
                && capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
                && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
    }

    private static final class NonRetryableUploadException extends IOException {
        NonRetryableUploadException(String message) {
            super(message);
        }
    }
}

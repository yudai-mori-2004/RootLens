package io.rootlens.mentra;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;
import android.util.AtomicFile;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
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
    private static final String RECEIPT_SCHEMA = "rootlens.mentra.upload_receipt.v1";
    private static final String COMMAND_STATE = "rootlens_upload_commands";
    private static final String LAST_COMMAND_ID = "last_command_id";

    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private RootLensAuth auth;
    private SharedPreferences commandState;
    private boolean uploadRunning;
    private int latestStartId;

    @Override
    public void onCreate() {
        super.onCreate();
        auth = new RootLensAuth(this);
        commandState = getSharedPreferences(COMMAND_STATE, MODE_PRIVATE);
        getSystemService(NotificationManager.class).createNotificationChannel(new NotificationChannel(
                AppContract.CHANNEL_ID, "RootLens capture", NotificationManager.IMPORTANCE_LOW));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        latestStartId = startId;
        if (uploadRunning) {
            Log.i(TAG, "Coalescing upload command while a scan is already running");
            return START_NOT_STICKY;
        }
        startForeground(AppContract.UPLOAD_NOTIFICATION_ID, notification("Scanning local clips", 0, 0));
        if (!acceptCommand(intent)) {
            finish("Duplicate upload command ignored", startId);
            return START_NOT_STICKY;
        }
        uploadRunning = true;
        worker.execute(() -> uploadPending(startId));
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

    private void uploadPending(int startId) {
        File root = new File(getExternalFilesDir(null), "recordings");
        boolean cleanupIncomplete = !cleanupDeletionTombstones(root);
        File[] candidates = root.listFiles(file -> file.isDirectory() && file.getName().startsWith("rec-"));
        if (candidates == null) candidates = new File[0];
        Arrays.sort(candidates, Comparator.comparing(File::getName));
        ArrayList<File> pending = new ArrayList<>();
        for (File candidate : candidates) {
            if (isUploaded(candidate, true)) {
                cleanupIncomplete |= !deleteUploadedClip(candidate);
            } else if (hasRequiredFiles(candidate)) {
                pending.add(candidate);
            }
        }
        if (pending.isEmpty()) {
            if (cleanupIncomplete) {
                CaptureFeedback.uploadUnavailable(this);
            }
            finish(cleanupIncomplete ? "Uploaded cleanup is incomplete" : "No pending clips", startId);
            return;
        }
        if (!auth.hasSession()) {
            CaptureFeedback.uploadUnavailable(this);
            finish("Sign in before upload", startId);
            return;
        }
        if (!hasValidatedWifi()) {
            CaptureFeedback.uploadUnavailable(this);
            finish("Waiting for Wi-Fi", startId);
            return;
        }

        CaptureFeedback.uploadStarted(this);
        int completed = 0;
        for (File directory : pending) {
            try {
                cleanupIncomplete |= !uploadClip(directory, completed, pending.size());
                completed++;
            } catch (Throwable error) {
                Log.e(TAG, "Upload failed for " + directory, error);
                writeUploadState(directory, "error", error.getMessage(),
                        jsonArray(uploadedFiles(directory)));
                CaptureFeedback.uploadUnavailable(this);
                finish("Upload failed · " + directory.getName(), startId);
                return;
            }
        }
        if (cleanupIncomplete) {
            CaptureFeedback.uploadUnavailable(this);
        } else {
            CaptureFeedback.uploadComplete(this);
        }
        finish("Uploaded " + completed + " clip" + (completed == 1 ? "" : "s"), startId);
    }

    private boolean uploadClip(File directory, int completedClips, int totalClips)
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
        writeUploadedReceipt(directory, contentHash);
        // R2 PUTだけでは削除しない。/api/clips の登録成功（既存行の冪等応答を含む）を
        // 確認してから、端末上のclip directoryを丸ごと削除する。
        return deleteUploadedClip(directory);
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

    private static boolean isUploaded(File directory, boolean requireContentHashFile) {
        File state = new File(directory, "upload_state.json");
        if (!state.isFile()) return false;
        try {
            JSONObject receipt = new JSONObject(readSmallFile(state));
            if (!RECEIPT_SCHEMA.equals(receipt.optString("schema"))
                    || !"uploaded".equals(receipt.optString("state"))
                    || !receipt.optBoolean("registered", false)) return false;
            String contentHash = receipt.optString("content_hash");
            if (!contentHash.matches("[0-9a-f]{64}")) return false;
            if (requireContentHashFile
                    && !contentHash.equals(readSmallFile(
                            new File(directory, "content_hash.txt")).trim())) return false;
            JSONArray names = receipt.optJSONArray("uploaded_files");
            if (names == null || names.length() != UPLOAD_FILES.length) return false;
            Set<String> actual = new HashSet<>();
            for (int index = 0; index < names.length(); index++) {
                actual.add(names.getString(index));
            }
            return actual.equals(new HashSet<>(Arrays.asList(UPLOAD_FILES)));
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

    private static boolean cleanupDeletionTombstones(File root) {
        File[] tombstones = root.listFiles(file -> file.isDirectory()
                && file.getName().startsWith("deleting-uploaded-"));
        if (tombstones == null) return true;
        boolean success = true;
        for (File tombstone : tombstones) {
            if (!deleteUploadedTombstone(tombstone)) {
                Log.w(TAG, "Could not finish local cleanup for " + tombstone);
                success = false;
            }
        }
        return success;
    }

    /** uploaded markerを持つclipだけを、再試行可能なtombstoneへ移して削除する。 */
    private static boolean deleteUploadedClip(File directory) {
        if (!directory.getName().startsWith("rec-") || !isUploaded(directory, true)) {
            Log.e(TAG, "Refusing to delete clip without uploaded marker: " + directory);
            return false;
        }
        File root = directory.getParentFile();
        if (root == null || !isDirectChild(root, directory)) {
            Log.e(TAG, "Refusing to delete clip without recordings root: " + directory);
            return false;
        }
        File tombstone = new File(root, "deleting-uploaded-" + directory.getName()
                + "-" + System.currentTimeMillis());
        if (!directory.renameTo(tombstone)) {
            // 元directoryとuploaded markerを残す。次のscanで安全に再試行できる。
            Log.w(TAG, "Could not stage uploaded clip for local deletion: " + directory);
            return false;
        }
        if (!deleteUploadedTombstone(tombstone)) {
            // tombstoneは次回scanの先頭で再削除する。upload対象には戻らない。
            Log.w(TAG, "Uploaded clip cleanup will be retried: " + tombstone);
            return false;
        }
        return true;
    }

    private static boolean deleteUploadedTombstone(File tombstone) {
        if (!tombstone.getName().startsWith("deleting-uploaded-")
                || tombstone.getParentFile() == null
                || !isDirectChild(tombstone.getParentFile(), tombstone)) return false;
        File[] initial = tombstone.listFiles();
        if (initial == null) return false;
        if (initial.length == 0) return tombstone.delete();
        // The receipt stays until every payload file is gone. A crash can therefore resume
        // cleanup without treating a partially deleted clip as a new upload candidate.
        if (!isUploaded(tombstone, false)) return false;
        boolean success = true;
        File receipt = new File(tombstone, "upload_state.json");
        for (File child : initial) {
            if (!child.equals(receipt)) success &= deleteRecursively(child);
        }
        if (!success) return false;
        if (receipt.exists() && !receipt.delete()) return false;
        return tombstone.delete();
    }

    private static boolean deleteRecursively(File target) {
        boolean success = true;
        if (target.isDirectory()) {
            File[] children = target.listFiles();
            if (children == null) return false;
            for (File child : children) success &= deleteRecursively(child);
        }
        if (target.exists() && !target.delete()) success = false;
        return success;
    }

    private static boolean isDirectChild(File root, File child) {
        try {
            return root.getCanonicalFile().equals(child.getCanonicalFile().getParentFile());
        } catch (IOException error) {
            return false;
        }
    }

    private static void writeUploadedReceipt(File directory, String contentHash)
            throws IOException, JSONException {
        JSONArray uploadedFiles = new JSONArray();
        for (String name : UPLOAD_FILES) uploadedFiles.put(name);
        JSONObject receipt = new JSONObject()
                .put("schema", RECEIPT_SCHEMA)
                .put("state", "uploaded")
                .put("registered", true)
                .put("content_hash", contentHash)
                .put("updated_at_epoch_ms", System.currentTimeMillis())
                .put("uploaded_files", uploadedFiles)
                .put("error", JSONObject.NULL);
        AtomicFile destination = new AtomicFile(new File(directory, "upload_state.json"));
        FileOutputStream stream = null;
        try {
            stream = destination.startWrite();
            stream.write((receipt.toString() + "\n").getBytes(StandardCharsets.UTF_8));
            stream.getFD().sync();
            destination.finishWrite(stream);
        } catch (IOException error) {
            if (stream != null) destination.failWrite(stream);
            throw error;
        }
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

    private void finish(String message, int startId) {
        getSystemService(NotificationManager.class).notify(
                AppContract.UPLOAD_NOTIFICATION_ID, notification(message, 0, 0));
        mainHandler.post(() -> {
            uploadRunning = false;
            if (stopSelfResult(Math.max(startId, latestStartId))) stopForeground(false);
        });
    }

    private boolean acceptCommand(Intent command) {
        String commandId = command == null
                ? null : command.getStringExtra(AppContract.EXTRA_COMMAND_ID);
        if (commandId == null) return true;
        if (commandId.equals(commandState.getString(LAST_COMMAND_ID, null))) {
            Log.i(TAG, "Ignoring duplicate physical upload command");
            return false;
        }
        if (!commandState.edit().putString(LAST_COMMAND_ID, commandId).commit()) {
            Log.e(TAG, "Could not durably record physical upload command");
            CaptureFeedback.uploadUnavailable(this);
            return false;
        }
        return true;
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

package io.rootlens.mentra;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class RootLensAuth {
    private static final String LOGIN_EMAIL_DOMAIN = "rl.local";
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "rootlens.mentra.auth.v1";
    private static final String PREFS = "rootlens_mentra_auth";
    private static final String PREF_SESSION = "session";

    private final SharedPreferences preferences;

    RootLensAuth(Context context) {
        preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    boolean isConfigured() {
        return !BuildConfig.SUPABASE_URL.isEmpty() && !BuildConfig.SUPABASE_ANON_KEY.isEmpty();
    }

    boolean hasSession() {
        return preferences.contains(PREF_SESSION);
    }

    synchronized void login(String loginId, String password) throws IOException {
        if (!isConfigured()) throw new IOException("Supabase URL/anon key are not configured at build time");
        if (loginId == null || loginId.trim().isEmpty() || password == null || password.isEmpty()) {
            throw new IOException("Login ID and password are required");
        }
        String email = loginId.contains("@") ? loginId.trim() : loginId.trim() + "@" + LOGIN_EMAIL_DOMAIN;
        try {
            JSONObject response = authRequest("password", new JSONObject()
                    .put("email", email)
                    .put("password", password));
            saveSession(response, loginId.trim());
        } catch (JSONException error) {
            throw new IOException("Authentication response was invalid", error);
        }
    }

    synchronized String accessToken() throws IOException {
        JSONObject session = loadSession();
        long expiresAtMs = session.optLong("expires_at_ms", 0);
        String accessToken = session.optString("access_token", "");
        if (!accessToken.isEmpty() && expiresAtMs > System.currentTimeMillis() + 60_000L) {
            return accessToken;
        }
        String refreshToken = session.optString("refresh_token", "");
        if (refreshToken.isEmpty()) throw new IOException("No refresh token; sign in again");
        try {
            JSONObject response = authRequest("refresh_token", new JSONObject()
                    .put("refresh_token", refreshToken));
            saveSession(response, session.optString("login_id", ""));
            return response.getString("access_token");
        } catch (JSONException error) {
            throw new IOException("Token refresh response was invalid", error);
        }
    }

    synchronized void logout() {
        preferences.edit().remove(PREF_SESSION).apply();
    }

    private JSONObject authRequest(String grantType, JSONObject body) throws IOException {
        String endpoint = trimTrailingSlash(BuildConfig.SUPABASE_URL)
                + "/auth/v1/token?grant_type=" + grantType;
        HttpURLConnection connection = (HttpURLConnection) new URL(endpoint).openConnection();
        connection.setConnectTimeout(20_000);
        connection.setReadTimeout(30_000);
        connection.setRequestMethod("POST");
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "application/json");
        connection.setRequestProperty("apikey", BuildConfig.SUPABASE_ANON_KEY);
        connection.setRequestProperty("Authorization", "Bearer " + BuildConfig.SUPABASE_ANON_KEY);
        byte[] payload = body.toString().getBytes(StandardCharsets.UTF_8);
        connection.setFixedLengthStreamingMode(payload.length);
        try (OutputStream output = connection.getOutputStream()) {
            output.write(payload);
        }
        int status = connection.getResponseCode();
        String response = readBody(status >= 200 && status < 300
                ? connection.getInputStream() : connection.getErrorStream());
        connection.disconnect();
        if (status < 200 || status >= 300) {
            String message = "authentication failed (HTTP " + status + ")";
            try {
                JSONObject error = new JSONObject(response);
                message = error.optString("msg", error.optString("error_description", message));
            } catch (JSONException ignored) {
            }
            throw new IOException(message);
        }
        try {
            return new JSONObject(response);
        } catch (JSONException error) {
            throw new IOException("Authentication returned invalid JSON", error);
        }
    }

    String loginId() throws IOException {
        return loadSession().optString("login_id", "");
    }

    private void saveSession(JSONObject response, String loginId) throws IOException {
        String access = response.optString("access_token", "");
        String refresh = response.optString("refresh_token", "");
        long expiresInSeconds = response.optLong("expires_in", 3600);
        if (access.isEmpty() || refresh.isEmpty()) throw new IOException("Authentication response has no tokens");
        try {
            JSONObject stored = new JSONObject()
                    .put("access_token", access)
                    .put("refresh_token", refresh)
                    .put("login_id", loginId)
                    .put("expires_at_ms", System.currentTimeMillis() + expiresInSeconds * 1000L);
            preferences.edit().putString(PREF_SESSION, encrypt(stored.toString())).apply();
        } catch (JSONException | GeneralSecurityException error) {
            throw new IOException("Could not securely store authentication session", error);
        }
    }

    private JSONObject loadSession() throws IOException {
        String encrypted = preferences.getString(PREF_SESSION, null);
        if (encrypted == null) throw new IOException("Not signed in");
        try {
            return new JSONObject(decrypt(encrypted));
        } catch (JSONException | GeneralSecurityException error) {
            throw new IOException("Stored authentication session is unreadable; sign in again", error);
        }
    }

    private static String encrypt(String cleartext) throws GeneralSecurityException, IOException {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, secretKey());
        byte[] ciphertext = cipher.doFinal(cleartext.getBytes(StandardCharsets.UTF_8));
        return Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":"
                + Base64.encodeToString(ciphertext, Base64.NO_WRAP);
    }

    private static String decrypt(String stored) throws GeneralSecurityException, IOException {
        String[] parts = stored.split(":", 2);
        if (parts.length != 2) throw new IOException("Encrypted session format is invalid");
        byte[] iv = Base64.decode(parts[0], Base64.NO_WRAP);
        byte[] ciphertext = Base64.decode(parts[1], Base64.NO_WRAP);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, secretKey(), new GCMParameterSpec(128, iv));
        return new String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8);
    }

    private static SecretKey secretKey() throws GeneralSecurityException, IOException {
        KeyStore store = KeyStore.getInstance(KEYSTORE);
        store.load(null);
        if (store.containsAlias(KEY_ALIAS)) {
            return (SecretKey) store.getKey(KEY_ALIAS, null);
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        generator.init(new KeyGenParameterSpec.Builder(
                KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build());
        return generator.generateKey();
    }

    static String readBody(InputStream input) throws IOException {
        if (input == null) return "";
        StringBuilder result = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(input, StandardCharsets.UTF_8))) {
            char[] buffer = new char[8192];
            int count;
            while ((count = reader.read(buffer)) >= 0) {
                if (count > 0) result.append(buffer, 0, count);
            }
        }
        return result.toString();
    }

    static String trimTrailingSlash(String value) {
        int end = value.length();
        while (end > 0 && value.charAt(end - 1) == '/') end--;
        return value.substring(0, end);
    }
}

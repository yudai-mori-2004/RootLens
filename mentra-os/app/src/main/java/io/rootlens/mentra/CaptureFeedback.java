package io.rootlens.mentra;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.res.AssetFileDescriptor;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioTrack;
import android.media.MediaPlayer;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import java.io.IOException;
import java.util.ArrayDeque;

final class CaptureFeedback {
    private static final String TAG = "RootLensFeedback";
    private static final String ASG_PACKAGE = "com.mentra.asg_client";
    private static final String ASG_SERVICE =
            "com.mentra.asg_client.service.core.AsgClientService";
    private static final String ACTION_I2S_AUDIO_STATE =
            "com.mentra.asg_client.ACTION_I2S_AUDIO_STATE";
    private static final String EXTRA_I2S_AUDIO_PLAYING = "extra_i2s_audio_playing";
    private static final int SAMPLE_RATE_HZ = 44_100;
    private static final int ROUTE_SETTLE_MS = 150;
    private static final int TONE_TO_VOICE_GAP_MS = 100;
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static final ArrayDeque<PlaybackRequest> QUEUE = new ArrayDeque<>();
    private static boolean playing;
    private static MediaPlayer activePlayer;

    static void started(Context context) {
        enqueue(context, new ToneStep[]{
                new ToneStep(880, 130),
                new ToneStep(0, 80),
                new ToneStep(1_175, 190)
        }, R.raw.capture_started);
    }

    static void stopped(Context context) {
        enqueue(context, new ToneStep[]{
                new ToneStep(1_175, 130),
                new ToneStep(0, 80),
                new ToneStep(660, 230)
        }, R.raw.capture_saved);
    }

    static void failed(Context context) {
        enqueue(context, new ToneStep[]{
                new ToneStep(220, 220),
                new ToneStep(0, 100),
                new ToneStep(220, 220),
                new ToneStep(0, 100),
                new ToneStep(220, 300)
        }, R.raw.capture_failed);
    }

    static void uploadStarted(Context context) {
        enqueue(context, new ToneStep[]{
                new ToneStep(660, 110),
                new ToneStep(0, 70),
                new ToneStep(880, 160)
        }, R.raw.upload_started);
    }

    static void uploadComplete(Context context) {
        enqueue(context, new ToneStep[]{
                new ToneStep(880, 100),
                new ToneStep(0, 60),
                new ToneStep(1_175, 100),
                new ToneStep(0, 60),
                new ToneStep(1_568, 190)
        }, R.raw.upload_complete);
    }

    static void uploadPaused(Context context) {
        enqueue(context, new ToneStep[]{
                new ToneStep(440, 150),
                new ToneStep(0, 80),
                new ToneStep(330, 240)
        }, R.raw.upload_paused);
    }

    static void errorTone(Context context) {
        enqueue(context, new ToneStep[]{
                new ToneStep(220, 220),
                new ToneStep(0, 100),
                new ToneStep(220, 220),
                new ToneStep(0, 100),
                new ToneStep(220, 300)
        }, 0);
    }

    private static void enqueue(Context context, ToneStep[] steps, int voiceResource) {
        Context appContext = context.getApplicationContext();
        MAIN.post(() -> {
            QUEUE.addLast(new PlaybackRequest(appContext, steps, voiceResource));
            if (!playing) playNext();
        });
    }

    private static void playNext() {
        PlaybackRequest request = QUEUE.pollFirst();
        if (request == null) {
            playing = false;
            return;
        }
        playing = true;
        AudioManager audio = (AudioManager) request.context.getSystemService(Context.AUDIO_SERVICE);
        int previousVolume = audio.getStreamVolume(AudioManager.STREAM_NOTIFICATION);
        int maximumVolume = audio.getStreamMaxVolume(AudioManager.STREAM_NOTIFICATION);
        try {
            audio.setStreamVolume(AudioManager.STREAM_NOTIFICATION, maximumVolume, 0);
            setI2sRoute(request.context, true);
        } catch (RuntimeException error) {
            Log.e(TAG, "Could not prepare Mentra I2S audio route", error);
        }
        MAIN.postDelayed(
                () -> playTone(request, audio, previousVolume),
                ROUTE_SETTLE_MS);
    }

    private static void playTone(
            PlaybackRequest request, AudioManager audio, int previousVolume) {
        short[] samples = synthesize(request.steps);
        int durationMs = samples.length * 1_000 / SAMPLE_RATE_HZ;
        final AudioTrack track;
        try {
            track = new AudioTrack.Builder()
                    .setAudioAttributes(notificationAttributes())
                    .setAudioFormat(new AudioFormat.Builder()
                            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                            .setSampleRate(SAMPLE_RATE_HZ)
                            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                            .build())
                    .setBufferSizeInBytes(samples.length * 2)
                    .setTransferMode(AudioTrack.MODE_STATIC)
                    .build();
            int written = track.write(samples, 0, samples.length);
            if (written != samples.length) {
                throw new IllegalStateException(
                        "AudioTrack accepted " + written + " of " + samples.length + " samples");
            }
            track.setVolume(0.65f);
            track.play();
        } catch (RuntimeException error) {
            Log.e(TAG, "Could not play Mentra feedback tone", error);
            finishPlayback(request.context, audio, previousVolume);
            return;
        }
        MAIN.postDelayed(() -> {
            try {
                track.stop();
            } catch (IllegalStateException ignored) {
            }
            track.release();
            playVoice(request, audio, previousVolume);
        }, durationMs + TONE_TO_VOICE_GAP_MS);
    }

    private static void playVoice(
            PlaybackRequest request, AudioManager audio, int previousVolume) {
        if (request.voiceResource == 0) {
            finishPlayback(request.context, audio, previousVolume);
            return;
        }
        final MediaPlayer player = new MediaPlayer();
        activePlayer = player;
        try (AssetFileDescriptor asset = request.context.getResources()
                .openRawResourceFd(request.voiceResource)) {
            if (asset == null) throw new IOException("Voice resource has no file descriptor");
            player.setAudioAttributes(notificationAttributes());
            player.setDataSource(
                    asset.getFileDescriptor(), asset.getStartOffset(), asset.getLength());
            player.setVolume(0.65f, 0.65f);
            player.setOnCompletionListener(completed -> {
                if (activePlayer == completed) activePlayer = null;
                Log.i(TAG, "Mentra voice playback completed");
                completed.release();
                finishPlayback(request.context, audio, previousVolume);
            });
            player.setOnErrorListener((failedPlayer, what, extra) -> {
                if (activePlayer == failedPlayer) activePlayer = null;
                Log.e(TAG, "Mentra voice playback failed: what=" + what + " extra=" + extra);
                failedPlayer.release();
                finishPlayback(request.context, audio, previousVolume);
                return true;
            });
            player.prepare();
            player.start();
            Log.i(TAG, "Mentra voice playback started: resource=" + request.voiceResource
                    + " duration_ms=" + player.getDuration());
        } catch (IOException | RuntimeException error) {
            Log.e(TAG, "Could not play Mentra voice resource", error);
            if (activePlayer == player) activePlayer = null;
            player.release();
            finishPlayback(request.context, audio, previousVolume);
        }
    }

    private static AudioAttributes notificationAttributes() {
        return new AudioAttributes.Builder()
                .setLegacyStreamType(AudioManager.STREAM_NOTIFICATION)
                .build();
    }

    private static void finishPlayback(
            Context context, AudioManager audio, int previousVolume) {
        try {
            setI2sRoute(context, false);
        } catch (RuntimeException error) {
            Log.e(TAG, "Could not close Mentra I2S audio route", error);
        }
        try {
            audio.setStreamVolume(AudioManager.STREAM_NOTIFICATION, previousVolume, 0);
        } catch (RuntimeException error) {
            Log.w(TAG, "Could not restore notification volume", error);
        }
        playing = false;
        MAIN.postDelayed(CaptureFeedback::playNext, 100L);
    }

    private static void setI2sRoute(Context context, boolean playing) {
        Intent route = new Intent()
                .setComponent(new ComponentName(ASG_PACKAGE, ASG_SERVICE))
                .setAction(ACTION_I2S_AUDIO_STATE)
                .putExtra(EXTRA_I2S_AUDIO_PLAYING, playing);
        context.startForegroundService(route);
    }

    private static short[] synthesize(ToneStep[] steps) {
        int totalSamples = 0;
        for (ToneStep step : steps) {
            totalSamples += SAMPLE_RATE_HZ * step.durationMs / 1_000;
        }
        short[] output = new short[totalSamples];
        int cursor = 0;
        for (ToneStep step : steps) {
            int count = SAMPLE_RATE_HZ * step.durationMs / 1_000;
            if (step.frequencyHz > 0) {
                int rampSamples = Math.min(SAMPLE_RATE_HZ / 100, count / 2);
                for (int index = 0; index < count; index++) {
                    double envelope = 1.0;
                    if (index < rampSamples) envelope = index / (double) rampSamples;
                    int remaining = count - index - 1;
                    if (remaining < rampSamples) {
                        envelope = Math.min(envelope, remaining / (double) rampSamples);
                    }
                    double phase = 2.0 * Math.PI * step.frequencyHz * index / SAMPLE_RATE_HZ;
                    output[cursor + index] = (short) Math.round(
                            Math.sin(phase) * envelope * Short.MAX_VALUE * 0.8);
                }
            }
            cursor += count;
        }
        return output;
    }

    private static final class PlaybackRequest {
        final Context context;
        final ToneStep[] steps;
        final int voiceResource;

        PlaybackRequest(Context context, ToneStep[] steps, int voiceResource) {
            this.context = context;
            this.steps = steps;
            this.voiceResource = voiceResource;
        }
    }

    private static final class ToneStep {
        final int frequencyHz;
        final int durationMs;

        ToneStep(int frequencyHz, int durationMs) {
            this.frequencyHz = frequencyHz;
            this.durationMs = durationMs;
        }
    }

    private CaptureFeedback() {}
}

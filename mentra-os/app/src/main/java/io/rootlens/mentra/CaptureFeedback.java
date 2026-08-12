package io.rootlens.mentra;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioTrack;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

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
    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    static void started(Context context) {
        play(context, new ToneStep[]{
                new ToneStep(880, 130),
                new ToneStep(0, 80),
                new ToneStep(1_175, 190)
        });
    }

    static void stopped(Context context) {
        play(context, new ToneStep[]{
                new ToneStep(1_175, 130),
                new ToneStep(0, 80),
                new ToneStep(660, 230)
        });
    }

    static void failed(Context context) {
        play(context, new ToneStep[]{
                new ToneStep(220, 220),
                new ToneStep(0, 100),
                new ToneStep(220, 220),
                new ToneStep(0, 100),
                new ToneStep(220, 300)
        });
    }

    private static void play(Context context, ToneStep[] steps) {
        Context appContext = context.getApplicationContext();
        short[] samples = synthesize(steps);
        int durationMs = samples.length * 1_000 / SAMPLE_RATE_HZ;
        MAIN.post(() -> {
            AudioManager audio = (AudioManager) appContext.getSystemService(Context.AUDIO_SERVICE);
            int previousVolume = audio.getStreamVolume(AudioManager.STREAM_NOTIFICATION);
            int maximumVolume = audio.getStreamMaxVolume(AudioManager.STREAM_NOTIFICATION);
            try {
                audio.setStreamVolume(AudioManager.STREAM_NOTIFICATION, maximumVolume, 0);
                setI2sRoute(appContext, true);
            } catch (RuntimeException error) {
                Log.e(TAG, "Could not prepare Mentra I2S audio route", error);
            }

            MAIN.postDelayed(() -> {
                final AudioTrack track;
                try {
                    track = new AudioTrack.Builder()
                            .setAudioAttributes(new AudioAttributes.Builder()
                                    .setLegacyStreamType(AudioManager.STREAM_NOTIFICATION)
                                    .build())
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
                    Log.e(TAG, "Could not play Mentra capture feedback", error);
                    restoreRoute(appContext, audio, previousVolume);
                    return;
                }
                MAIN.postDelayed(() -> {
                    try {
                        track.stop();
                    } catch (IllegalStateException ignored) {
                    }
                    track.release();
                    restoreRoute(appContext, audio, previousVolume);
                }, durationMs + 150L);
            }, ROUTE_SETTLE_MS);
        });
    }

    private static void restoreRoute(
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

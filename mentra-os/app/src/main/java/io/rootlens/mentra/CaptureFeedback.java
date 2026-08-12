package io.rootlens.mentra;

import android.media.AudioManager;
import android.media.ToneGenerator;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

final class CaptureFeedback {
    private static final String TAG = "RootLensFeedback";
    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    static void started() {
        play(ToneGenerator.TONE_PROP_ACK, 120, 180, ToneGenerator.TONE_PROP_ACK, 160);
    }

    static void stopped() {
        play(ToneGenerator.TONE_PROP_BEEP2, 180, 0, 0, 0);
    }

    static void failed() {
        play(ToneGenerator.TONE_SUP_ERROR, 250, 180, ToneGenerator.TONE_SUP_ERROR, 250);
    }

    private static void play(int first, int firstDurationMs, int gapMs, int second, int secondDurationMs) {
        MAIN.post(() -> {
            final ToneGenerator tone;
            try {
                tone = new ToneGenerator(AudioManager.STREAM_MUSIC, 100);
                tone.startTone(first, firstDurationMs);
            } catch (RuntimeException error) {
                Log.w(TAG, "Could not play capture feedback", error);
                return;
            }
            int releaseAfterMs = firstDurationMs + 100;
            if (second != 0) {
                MAIN.postDelayed(() -> tone.startTone(second, secondDurationMs),
                        firstDurationMs + gapMs);
                releaseAfterMs = firstDurationMs + gapMs + secondDurationMs + 100;
            }
            MAIN.postDelayed(tone::release, releaseAfterMs);
        });
    }

    private CaptureFeedback() {}
}

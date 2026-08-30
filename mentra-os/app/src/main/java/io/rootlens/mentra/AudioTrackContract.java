package io.rootlens.mentra;

import java.io.IOException;

/** Pure validation for the audio properties that make a field clip deliverable. */
final class AudioTrackContract {
    static final long MAX_VIDEO_EDGE_DELTA_US = 2_000_000L;

    static void validate(
            int sampleRateHz,
            int channelCount,
            int sampleCount,
            long firstAudioPtsUs,
            long lastAudioPtsUs,
            long firstVideoPtsUs,
            long lastVideoPtsUs) throws IOException {
        if (sampleRateHz != AppContract.AUDIO_SAMPLE_RATE_HZ) {
            throw new IOException("Recorded audio sample rate is " + sampleRateHz
                    + " Hz, expected " + AppContract.AUDIO_SAMPLE_RATE_HZ + " Hz");
        }
        if (channelCount != AppContract.AUDIO_CHANNELS) {
            throw new IOException("Recorded audio channel count is " + channelCount
                    + ", expected " + AppContract.AUDIO_CHANNELS);
        }
        if (sampleCount <= 0 || firstAudioPtsUs < 0L || lastAudioPtsUs < firstAudioPtsUs) {
            throw new IOException("MP4 audio track has no valid samples");
        }
        if (firstVideoPtsUs < 0L || lastVideoPtsUs < firstVideoPtsUs) {
            throw new IOException("MP4 video track has no valid timestamp span");
        }
        long startDeltaUs = absoluteDifference(firstAudioPtsUs, firstVideoPtsUs);
        long endDeltaUs = absoluteDifference(lastAudioPtsUs, lastVideoPtsUs);
        if (startDeltaUs > MAX_VIDEO_EDGE_DELTA_US || endDeltaUs > MAX_VIDEO_EDGE_DELTA_US) {
            throw new IOException("Audio does not cover the video timeline: start delta "
                    + startDeltaUs + " us, end delta " + endDeltaUs + " us");
        }
    }

    private static long absoluteDifference(long left, long right) {
        return left >= right ? left - right : right - left;
    }

    private AudioTrackContract() {}
}

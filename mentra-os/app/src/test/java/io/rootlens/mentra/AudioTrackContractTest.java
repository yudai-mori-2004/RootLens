package io.rootlens.mentra;

import java.io.IOException;

final class AudioTrackContractTest {
    public static void main(String[] args) throws Exception {
        acceptsCompleteTrackWithNormalMuxerSkew();
        acceptsQuietTrackBecauseSignalContentIsNotAContainerFailure();
        rejectsWrongSampleRate();
        rejectsWrongChannelCount();
        rejectsMissingSamples();
        rejectsAudioThatStartsTooLate();
        rejectsAudioThatEndsTooEarly();
        System.out.println("AudioTrackContract tests passed");
    }

    private static void acceptsCompleteTrackWithNormalMuxerSkew() throws Exception {
        AudioTrackContract.validate(48_000, 1, 707, 0, 15_061_333, 10_500, 14_899_455);
    }

    private static void acceptsQuietTrackBecauseSignalContentIsNotAContainerFailure() throws Exception {
        AudioTrackContract.validate(48_000, 1, 100, 0, 2_100_000, 20_000, 2_050_000);
    }

    private static void rejectsWrongSampleRate() {
        expectFailure(() -> AudioTrackContract.validate(
                44_100, 1, 707, 0, 15_000_000, 0, 15_000_000));
    }

    private static void rejectsWrongChannelCount() {
        expectFailure(() -> AudioTrackContract.validate(
                48_000, 2, 707, 0, 15_000_000, 0, 15_000_000));
    }

    private static void rejectsMissingSamples() {
        expectFailure(() -> AudioTrackContract.validate(
                48_000, 1, 0, -1, -1, 0, 15_000_000));
    }

    private static void rejectsAudioThatStartsTooLate() {
        expectFailure(() -> AudioTrackContract.validate(
                48_000, 1, 500, 3_000_000, 15_000_000, 0, 15_000_000));
    }

    private static void rejectsAudioThatEndsTooEarly() {
        expectFailure(() -> AudioTrackContract.validate(
                48_000, 1, 500, 0, 12_000_000, 0, 15_000_000));
    }

    private static void expectFailure(ThrowingRunnable action) {
        try {
            action.run();
            throw new AssertionError("Expected validation failure");
        } catch (IOException expected) {
            // Expected.
        }
    }

    private interface ThrowingRunnable {
        void run() throws IOException;
    }
}

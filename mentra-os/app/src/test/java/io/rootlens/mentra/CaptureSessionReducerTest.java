package io.rootlens.mentra;

final class CaptureSessionReducerTest {
    public static void main(String[] args) {
        duplicateStartIsIdempotent();
        stopBeforeOpenCancelsStaleTimer();
        fiveHourRequestCreatesOneFiveHourClip();
        recordingSchedulesTimeAndStorageGuards();
        manualStopCommitsOneClip();
        timeLimitStopsWithoutStartingAnotherClip();
        storageLimitStopsWithoutStartingAnotherClip();
        duplicateStopWhileFinalizingIsIdempotent();
        restrictedCameraOpenRetriesSameClip();
        staleLimitEventIsIgnored();
        cameraFailureFailsLoudly();
        manualStopDuringOpenDoesNotBecomeFailure();
        failedFinalizationAfterRecordingFailsLoudly();
        System.out.println("CaptureSessionReducer tests passed");
    }

    private static void duplicateStartIsIdempotent() {
        CaptureSessionReducer.State idle = CaptureSessionReducer.State.idle();
        CaptureSessionReducer.Transition first = reduce(idle,
                CaptureSessionReducer.Event.start(18_000));
        CaptureSessionReducer.Transition duplicate = reduce(first.state,
                CaptureSessionReducer.Event.start(18_000));
        require(first.state.phase == CaptureSessionReducer.Phase.START_PENDING, "start pending");
        require(first.effects.size() == 2, "acknowledge then schedule start");
        require(first.effects.get(0).type
                == CaptureSessionReducer.EffectType.ACKNOWLEDGE_START,
                "accepted start is acknowledged immediately");
        require(first.effects.get(1).delayMs
                        == CaptureSessionReducer.INITIAL_OPEN_DELAY_MS,
                "camera waits until the spoken start cue has finished");
        require(duplicate.state == first.state, "duplicate start returns same state instance");
        require(duplicate.effects.isEmpty(), "duplicate start has no effects");
    }

    private static void stopBeforeOpenCancelsStaleTimer() {
        CaptureSessionReducer.Transition started = reduce(
                CaptureSessionReducer.State.idle(), CaptureSessionReducer.Event.start(18_000));
        long generation = started.state.generation;
        CaptureSessionReducer.Transition stopped = reduce(
                started.state, CaptureSessionReducer.Event.stop());
        CaptureSessionReducer.Transition stale = reduce(
                stopped.state, CaptureSessionReducer.Event.openTimer(generation));
        require(stopped.state.phase == CaptureSessionReducer.Phase.SUCCEEDED, "pending stop succeeds");
        require(stopped.effects.size() == 3, "pending stop acknowledges, cancels and finishes");
        require(stale.state == stopped.state && stale.effects.isEmpty(), "stale timer ignored");
    }

    private static void fiveHourRequestCreatesOneFiveHourClip() {
        CaptureSessionReducer.Transition start = reduce(
                CaptureSessionReducer.State.idle(), CaptureSessionReducer.Event.start(18_000));
        CaptureSessionReducer.State opening = reduce(start.state,
                CaptureSessionReducer.Event.openTimer(start.state.generation)).state;
        require(opening.currentSegmentSeconds == 18_000,
                "the clip retains the full five-hour safety duration");
    }

    private static void recordingSchedulesTimeAndStorageGuards() {
        CaptureSessionReducer.State recording = recording(18_000);
        CaptureSessionReducer.Transition started = segmentStartedTransition(18_000);
        require(recording.phase == CaptureSessionReducer.Phase.RECORDING, "recording");
        require(started.effects.size() == 2, "two safety guards are scheduled");
        require(effect(started, CaptureSessionReducer.EffectType.SCHEDULE_TIME_LIMIT) != null,
                "five-hour time limit is scheduled");
        require(effect(started, CaptureSessionReducer.EffectType.SCHEDULE_STORAGE_CHECK) != null,
                "storage monitor is scheduled");
        require(effect(started, CaptureSessionReducer.EffectType.SCHEDULE_TIME_LIMIT).delayMs
                        == 18_000_000L,
                "time limit matches the requested capture duration");
    }

    private static void manualStopCommitsOneClip() {
        CaptureSessionReducer.State recording = recording(18_000);
        CaptureSessionReducer.Transition stop = reduce(recording,
                CaptureSessionReducer.Event.stop());
        require(stop.state.phase == CaptureSessionReducer.Phase.FINALIZING, "finalizing");
        require(stop.state.stopCause == CaptureSessionReducer.StopCause.USER, "user stop recorded");
        require(effect(stop, CaptureSessionReducer.EffectType.CANCEL_TIME_LIMIT) != null,
                "time limit cancelled");
        require(effect(stop, CaptureSessionReducer.EffectType.CANCEL_STORAGE_CHECK) != null,
                "storage monitor cancelled");
        CaptureSessionReducer.Transition completed = reduce(stop.state,
                CaptureSessionReducer.Event.segmentCompleted(stop.state.generation, "/clip"));
        require(completed.state.phase == CaptureSessionReducer.Phase.SUCCEEDED, "manual success");
        require(completed.state.completedClipCount == 1, "one committed clip");
    }

    private static void timeLimitStopsWithoutStartingAnotherClip() {
        CaptureSessionReducer.State recording = recording(18_000);
        CaptureSessionReducer.Transition stop = reduce(recording,
                CaptureSessionReducer.Event.timeLimitReached(recording.generation));
        require(stop.state.stopCause == CaptureSessionReducer.StopCause.TIME_LIMIT,
                "time limit is retained as the cause");
        CaptureSessionReducer.Transition completed = reduce(stop.state,
                CaptureSessionReducer.Event.segmentCompleted(stop.state.generation, "/clip"));
        require(completed.state.phase == CaptureSessionReducer.Phase.SUCCEEDED,
                "time-limited clip succeeds");
        require(completed.state.completedClipCount == 1, "one clip only");
        require(completed.effects.get(completed.effects.size() - 1).type
                        == CaptureSessionReducer.EffectType.FINISH_SUCCEEDED,
                "session ends instead of opening another clip");
    }

    private static void storageLimitStopsWithoutStartingAnotherClip() {
        CaptureSessionReducer.State recording = recording(18_000);
        CaptureSessionReducer.Transition stop = reduce(recording,
                CaptureSessionReducer.Event.storageLimitReached(recording.generation));
        require(stop.state.phase == CaptureSessionReducer.Phase.FINALIZING,
                "storage threshold finalizes the active clip");
        require(stop.state.stopCause == CaptureSessionReducer.StopCause.STORAGE_LIMIT,
                "storage limit is retained as the cause");
        require(stop.effects.get(0).type
                        == CaptureSessionReducer.EffectType.ACKNOWLEDGE_STOP,
                "forced stop is audible to the worker");
        CaptureSessionReducer.Transition completed = reduce(stop.state,
                CaptureSessionReducer.Event.segmentCompleted(stop.state.generation, "/clip"));
        require(completed.state.phase == CaptureSessionReducer.Phase.SUCCEEDED,
                "storage-limited clip is preserved");
        require(completed.state.completedClipCount == 1, "one clip only");
    }

    private static void duplicateStopWhileFinalizingIsIdempotent() {
        CaptureSessionReducer.State recording = recording(18_000);
        CaptureSessionReducer.Transition first = reduce(recording,
                CaptureSessionReducer.Event.stop());
        CaptureSessionReducer.Transition duplicate = reduce(first.state,
                CaptureSessionReducer.Event.stop());
        require(duplicate.state == first.state && duplicate.effects.isEmpty(),
                "duplicate stop ignored");
    }

    private static void restrictedCameraOpenRetriesSameClip() {
        CaptureSessionReducer.Transition start = reduce(
                CaptureSessionReducer.State.idle(), CaptureSessionReducer.Event.start(18_000));
        CaptureSessionReducer.State opening = reduce(start.state,
                CaptureSessionReducer.Event.openTimer(start.state.generation)).state;
        CaptureSessionReducer.Transition retry = reduce(opening,
                CaptureSessionReducer.Event.segmentOpenRetry(
                        opening.generation, "/failed-attempt", "restricted"));
        require(retry.state.phase == CaptureSessionReducer.Phase.START_PENDING,
                "recoverable camera rejection returns to pending");
        require(retry.state.generation == opening.generation,
                "retry keeps the current clip generation");
        require(retry.state.remainingSeconds == 18_000,
                "retry retains the full requested duration");
    }

    private static void staleLimitEventIsIgnored() {
        CaptureSessionReducer.State recording = recording(18_000);
        CaptureSessionReducer.Transition stale = reduce(recording,
                CaptureSessionReducer.Event.storageLimitReached(recording.generation + 1));
        require(stale.state == recording && stale.effects.isEmpty(),
                "stale storage callback cannot stop the current clip");
    }

    private static void cameraFailureFailsLoudly() {
        CaptureSessionReducer.State recording = recording(18_000);
        CaptureSessionReducer.Transition failed = reduce(recording,
                CaptureSessionReducer.Event.segmentFailed(
                        recording.generation, "/failed", "Camera disconnected"));
        require(failed.state.phase == CaptureSessionReducer.Phase.FAILED, "camera failure terminal");
        require(failed.effects.get(failed.effects.size() - 1).type
                        == CaptureSessionReducer.EffectType.FINISH_FAILED,
                "failure announced");
    }

    private static void manualStopDuringOpenDoesNotBecomeFailure() {
        CaptureSessionReducer.Transition start = reduce(
                CaptureSessionReducer.State.idle(), CaptureSessionReducer.Event.start(18_000));
        CaptureSessionReducer.State opening = reduce(start.state,
                CaptureSessionReducer.Event.openTimer(start.state.generation)).state;
        CaptureSessionReducer.State finalizing = reduce(opening,
                CaptureSessionReducer.Event.stop()).state;
        CaptureSessionReducer.Transition callback = reduce(finalizing,
                CaptureSessionReducer.Event.segmentFailed(
                        finalizing.generation, "/partial", "Stopped before open"));
        require(callback.state.phase == CaptureSessionReducer.Phase.SUCCEEDED,
                "intentional early stop succeeds");
    }

    private static void failedFinalizationAfterRecordingFailsLoudly() {
        CaptureSessionReducer.State recording = recording(18_000);
        CaptureSessionReducer.State finalizing = reduce(recording,
                CaptureSessionReducer.Event.stop()).state;
        CaptureSessionReducer.Transition failed = reduce(finalizing,
                CaptureSessionReducer.Event.segmentFailed(
                        finalizing.generation, "/partial", "MP4 finalization failed"));
        require(failed.state.phase == CaptureSessionReducer.Phase.FAILED,
                "a started recording cannot report success when finalization fails");
    }

    private static CaptureSessionReducer.State recording(long duration) {
        return segmentStartedTransition(duration).state;
    }

    private static CaptureSessionReducer.Transition segmentStartedTransition(long duration) {
        CaptureSessionReducer.Transition start = reduce(
                CaptureSessionReducer.State.idle(), CaptureSessionReducer.Event.start(duration));
        CaptureSessionReducer.State opening = reduce(start.state,
                CaptureSessionReducer.Event.openTimer(start.state.generation)).state;
        return reduce(opening, CaptureSessionReducer.Event.segmentStarted(
                opening.generation, "/clip", "recording"));
    }

    private static CaptureSessionReducer.Effect effect(
            CaptureSessionReducer.Transition transition,
            CaptureSessionReducer.EffectType type) {
        for (CaptureSessionReducer.Effect effect : transition.effects) {
            if (effect.type == type) return effect;
        }
        return null;
    }

    private static CaptureSessionReducer.Transition reduce(
            CaptureSessionReducer.State state, CaptureSessionReducer.Event event) {
        return CaptureSessionReducer.reduce(state, event);
    }

    private static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    private CaptureSessionReducerTest() {}
}

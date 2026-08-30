package io.rootlens.mentra;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/** Pure capture-session policy. Android and camera I/O are interpreted by CaptureService. */
final class CaptureSessionReducer {
    // The stock start cue plus the trimmed voice is about 1.97 s; this leaves roughly the same
    // route-open/cleanup margin observed on the device before Camera2 takes the microphone.
    static final long INITIAL_OPEN_DELAY_MS = 3_200L;
    static final long CAMERA_ACCESS_RETRY_DELAY_MS = 1_500L;
    static final long STORAGE_CHECK_INTERVAL_MS = 5_000L;

    enum Phase {
        IDLE,
        START_PENDING,
        OPENING,
        RECORDING,
        FINALIZING,
        SUCCEEDED,
        FAILED
    }

    enum StopCause {
        NONE,
        USER,
        TIME_LIMIT,
        STORAGE_LIMIT
    }

    enum EventType {
        START,
        STOP,
        OPEN_TIMER,
        SEGMENT_OPEN_RETRY,
        SEGMENT_STARTED,
        SEGMENT_COMPLETED,
        SEGMENT_FAILED,
        TIME_LIMIT_REACHED,
        STORAGE_LIMIT_REACHED,
        PREFLIGHT_FAILED
    }

    enum EffectType {
        ACKNOWLEDGE_START,
        ACKNOWLEDGE_STOP,
        SCHEDULE_OPEN,
        CANCEL_OPEN,
        OPEN_SEGMENT,
        SCHEDULE_TIME_LIMIT,
        CANCEL_TIME_LIMIT,
        SCHEDULE_STORAGE_CHECK,
        CANCEL_STORAGE_CHECK,
        STOP_SEGMENT,
        FINISH_SUCCEEDED,
        FINISH_FAILED
    }

    static final class State {
        final Phase phase;
        final long generation;
        final long remainingSeconds;
        final int currentSegmentSeconds;
        final int completedClipCount;
        final StopCause stopCause;
        final String message;
        final String artifactPath;

        private State(
                Phase phase,
                long generation,
                long remainingSeconds,
                int currentSegmentSeconds,
                int completedClipCount,
                StopCause stopCause,
                String message,
                String artifactPath) {
            this.phase = phase;
            this.generation = generation;
            this.remainingSeconds = remainingSeconds;
            this.currentSegmentSeconds = currentSegmentSeconds;
            this.completedClipCount = completedClipCount;
            this.stopCause = stopCause;
            this.message = message;
            this.artifactPath = artifactPath;
        }

        static State idle() {
            return new State(Phase.IDLE, 0L, 0L, 0, 0,
                    StopCause.NONE, "Idle", null);
        }

        boolean isActive() {
            return phase == Phase.START_PENDING
                    || phase == Phase.OPENING
                    || phase == Phase.RECORDING
                    || phase == Phase.FINALIZING;
        }
    }

    static final class Event {
        final EventType type;
        final long generation;
        final long requestedSeconds;
        final String message;
        final String artifactPath;

        private Event(
                EventType type,
                long generation,
                long requestedSeconds,
                String message,
                String artifactPath) {
            this.type = type;
            this.generation = generation;
            this.requestedSeconds = requestedSeconds;
            this.message = message;
            this.artifactPath = artifactPath;
        }

        static Event start(long requestedSeconds) {
            return new Event(EventType.START, 0L, requestedSeconds, null, null);
        }

        static Event stop() {
            return new Event(EventType.STOP, 0L, 0L, null, null);
        }

        static Event openTimer(long generation) {
            return new Event(EventType.OPEN_TIMER, generation, 0L, null, null);
        }

        static Event segmentStarted(long generation, String artifactPath, String message) {
            return new Event(
                    EventType.SEGMENT_STARTED, generation, 0L, message, artifactPath);
        }

        static Event segmentOpenRetry(long generation, String artifactPath, String message) {
            return new Event(
                    EventType.SEGMENT_OPEN_RETRY, generation, 0L, message, artifactPath);
        }

        static Event segmentCompleted(long generation, String artifactPath) {
            return new Event(
                    EventType.SEGMENT_COMPLETED, generation, 0L, null, artifactPath);
        }

        static Event segmentFailed(long generation, String artifactPath, String message) {
            return new Event(
                    EventType.SEGMENT_FAILED, generation, 0L, message, artifactPath);
        }

        static Event timeLimitReached(long generation) {
            return new Event(EventType.TIME_LIMIT_REACHED, generation, 0L, null, null);
        }

        static Event storageLimitReached(long generation) {
            return new Event(EventType.STORAGE_LIMIT_REACHED, generation, 0L, null, null);
        }

        static Event preflightFailed(String message) {
            return new Event(EventType.PREFLIGHT_FAILED, 0L, 0L, message, null);
        }
    }

    static final class Effect {
        final EffectType type;
        final long generation;
        final long delayMs;

        private Effect(EffectType type, long generation, long delayMs) {
            this.type = type;
            this.generation = generation;
            this.delayMs = delayMs;
        }

        static Effect now(EffectType type, long generation) {
            return new Effect(type, generation, 0L);
        }

        static Effect after(EffectType type, long generation, long delayMs) {
            return new Effect(type, generation, delayMs);
        }
    }

    static final class Transition {
        final State state;
        final List<Effect> effects;

        private Transition(State state, List<Effect> effects) {
            this.state = state;
            this.effects = effects;
        }
    }

    static Transition reduce(State state, Event event) {
        if (isStale(state, event)) return unchanged(state);
        switch (event.type) {
            case START:
                return start(state, event.requestedSeconds);
            case STOP:
                return stop(state);
            case OPEN_TIMER:
                return openTimer(state);
            case SEGMENT_OPEN_RETRY:
                return segmentOpenRetry(state, event);
            case SEGMENT_STARTED:
                return segmentStarted(state, event);
            case SEGMENT_COMPLETED:
                return segmentCompleted(state, event);
            case SEGMENT_FAILED:
                return segmentFailed(state, event);
            case TIME_LIMIT_REACHED:
                return stopForLimit(state, StopCause.TIME_LIMIT,
                        "Capture time limit reached; finalizing clip");
            case STORAGE_LIMIT_REACHED:
                return stopForLimit(state, StopCause.STORAGE_LIMIT,
                        "Storage safety reserve reached; finalizing clip");
            case PREFLIGHT_FAILED:
                return preflightFailed(state, event.message);
            default:
                return unchanged(state);
        }
    }

    private static Transition start(State state, long requestedSeconds) {
        if (state.phase != Phase.IDLE) return unchanged(state);
        long duration = Math.max(1L, requestedSeconds);
        State next = new State(
                Phase.START_PENDING,
                state.generation + 1L,
                duration,
                0,
                0,
                StopCause.NONE,
                "Capture start pending",
                null);
        return transition(next,
                Effect.now(EffectType.ACKNOWLEDGE_START, next.generation),
                Effect.after(EffectType.SCHEDULE_OPEN, next.generation, INITIAL_OPEN_DELAY_MS));
    }

    private static Transition stop(State state) {
        switch (state.phase) {
            case START_PENDING:
                return transition(succeeded(state, "Capture stopped before camera open"),
                        Effect.now(EffectType.ACKNOWLEDGE_STOP, state.generation),
                        Effect.now(EffectType.CANCEL_OPEN, state.generation),
                        Effect.now(EffectType.FINISH_SUCCEEDED, state.generation));
            case OPENING:
            case RECORDING:
                return beginFinalization(
                        state, StopCause.USER, "Capture stopped by request; finalizing clip");
            case FINALIZING:
            case SUCCEEDED:
            case FAILED:
            case IDLE:
            default:
                return unchanged(state);
        }
    }

    private static Transition stopForLimit(State state, StopCause cause, String message) {
        if (state.phase != Phase.RECORDING) return unchanged(state);
        return beginFinalization(state, cause, message);
    }

    private static Transition beginFinalization(
            State state, StopCause cause, String message) {
        State finalizing = new State(
                Phase.FINALIZING,
                state.generation,
                state.remainingSeconds,
                state.currentSegmentSeconds,
                state.completedClipCount,
                cause,
                message,
                state.artifactPath);
        return transition(finalizing,
                Effect.now(EffectType.ACKNOWLEDGE_STOP, state.generation),
                Effect.now(EffectType.CANCEL_TIME_LIMIT, state.generation),
                Effect.now(EffectType.CANCEL_STORAGE_CHECK, state.generation),
                Effect.now(EffectType.STOP_SEGMENT, state.generation));
    }

    private static Transition openTimer(State state) {
        if (state.phase != Phase.START_PENDING) return unchanged(state);
        State opening = new State(
                Phase.OPENING,
                state.generation,
                state.remainingSeconds,
                (int) state.remainingSeconds,
                state.completedClipCount,
                StopCause.NONE,
                "Opening exclusive camera session",
                null);
        return transition(opening, Effect.now(EffectType.OPEN_SEGMENT, state.generation));
    }

    private static Transition segmentStarted(State state, Event event) {
        if (state.phase != Phase.OPENING) return unchanged(state);
        State recording = new State(
                Phase.RECORDING,
                state.generation,
                state.remainingSeconds,
                state.currentSegmentSeconds,
                state.completedClipCount,
                StopCause.NONE,
                event.message == null ? "Recording" : event.message,
                event.artifactPath);
        return transition(recording,
                Effect.after(
                        EffectType.SCHEDULE_TIME_LIMIT,
                        state.generation,
                        state.currentSegmentSeconds * 1_000L),
                Effect.after(
                        EffectType.SCHEDULE_STORAGE_CHECK,
                        state.generation,
                        STORAGE_CHECK_INTERVAL_MS));
    }

    private static Transition segmentOpenRetry(State state, Event event) {
        if (state.phase != Phase.OPENING) return unchanged(state);
        State pending = new State(
                Phase.START_PENDING,
                state.generation,
                state.remainingSeconds,
                0,
                state.completedClipCount,
                StopCause.NONE,
                event.message == null ? "Camera access retry pending" : event.message,
                event.artifactPath);
        return transition(pending, Effect.after(
                EffectType.SCHEDULE_OPEN,
                pending.generation,
                CAMERA_ACCESS_RETRY_DELAY_MS));
    }

    private static Transition segmentCompleted(State state, Event event) {
        if (state.phase != Phase.FINALIZING) return unchanged(state);
        String message;
        switch (state.stopCause) {
            case STORAGE_LIMIT:
                message = "Capture stopped before storage was exhausted";
                break;
            case TIME_LIMIT:
                message = "Capture reached the five-hour safety limit";
                break;
            case USER:
            default:
                message = "Capture stopped by request";
                break;
        }
        State completed = new State(
                Phase.SUCCEEDED,
                state.generation,
                0L,
                0,
                state.completedClipCount + 1,
                state.stopCause,
                message,
                event.artifactPath);
        return transition(completed,
                Effect.now(EffectType.CANCEL_TIME_LIMIT, state.generation),
                Effect.now(EffectType.CANCEL_STORAGE_CHECK, state.generation),
                Effect.now(EffectType.FINISH_SUCCEEDED, state.generation));
    }

    private static Transition segmentFailed(State state, Event event) {
        if (state.phase != Phase.OPENING
                && state.phase != Phase.RECORDING
                && state.phase != Phase.FINALIZING) {
            return unchanged(state);
        }
        if (state.phase == Phase.FINALIZING
                && state.stopCause == StopCause.USER
                && state.artifactPath == null) {
            return transition(succeeded(state, "Capture stopped before a clip was committed"),
                    Effect.now(EffectType.CANCEL_TIME_LIMIT, state.generation),
                    Effect.now(EffectType.CANCEL_STORAGE_CHECK, state.generation),
                    Effect.now(EffectType.FINISH_SUCCEEDED, state.generation));
        }
        State failed = new State(
                Phase.FAILED,
                state.generation,
                state.remainingSeconds,
                0,
                state.completedClipCount,
                StopCause.NONE,
                event.message == null ? "Capture failed" : event.message,
                event.artifactPath);
        return transition(failed,
                Effect.now(EffectType.CANCEL_OPEN, state.generation),
                Effect.now(EffectType.CANCEL_TIME_LIMIT, state.generation),
                Effect.now(EffectType.CANCEL_STORAGE_CHECK, state.generation),
                Effect.now(EffectType.FINISH_FAILED, state.generation));
    }

    private static Transition preflightFailed(State state, String message) {
        if (state.phase != Phase.IDLE) return unchanged(state);
        State failed = new State(
                Phase.FAILED,
                state.generation + 1L,
                0L,
                0,
                0,
                StopCause.NONE,
                message == null ? "Capture preflight failed" : message,
                null);
        return transition(failed, Effect.now(EffectType.FINISH_FAILED, failed.generation));
    }

    private static State succeeded(State state, String message) {
        return new State(
                Phase.SUCCEEDED,
                state.generation,
                0L,
                0,
                state.completedClipCount,
                state.stopCause,
                message,
                null);
    }

    private static boolean isStale(State state, Event event) {
        return event.generation != 0L && event.generation != state.generation;
    }

    private static Transition unchanged(State state) {
        return new Transition(state, Collections.emptyList());
    }

    private static Transition transition(State state, Effect... effects) {
        return new Transition(
                state, Collections.unmodifiableList(Arrays.asList(effects)));
    }

    private CaptureSessionReducer() {}
}

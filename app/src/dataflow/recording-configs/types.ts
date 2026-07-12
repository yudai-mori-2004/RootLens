// Abstract interface for a recording config.
//
// A recording config bundles one way of capturing data: which native module
// runs the camera and sensors, and which files end up in the session dir.
// The upload steps never care which config produced a session; the config's
// outputFiles list is the single authority on what gets uploaded.
//
// Current implementations:
//   - arkit (iOS)  ← the arkit-capture native module
// A future rig (smart glasses, ...) plugs in as another config here.
//
// ⚠ Dataflow layer: must not import react / react-native.

import type { EventSink } from '../events';

// ─── Realtime hand tracking (the surface the gesture UX sits on) ───────
// Gesture and calibration UX is a thin layer on top of a recording config and
// stays unaware of native differences. The config abstraction therefore exposes
// the hand-track subscription, and the UX layer only ever calls
// config.subscribeHandTrack(). The types mirror the native onHandTrack payload.

export interface HandLandmark {
  x: number;        // 0..1, top-left origin
  y: number;        // 0..1
  confidence: number;
}

export type GestureKind = 'open_palm' | 'thumbs_up';

export interface WearerHandObservation {
  handedness: 'left' | 'right' | 'unknown';
  confidence: number;
  landmarks: HandLandmark[];   // always 21 entries, MediaPipe order
  /** Per-hand gesture classification (native geometric heuristic; null when
   *  undecidable). Combining both hands into a frame-level gesture is the UI
   *  layer's job. */
  gesture: GestureKind | null;
}

/** One frame of hand state. Mirrors the native onHandTrack payload. */
export interface HandTrackEvent {
  timestampNs: string;
  imageWidth: number;
  imageHeight: number;
  wearerHandCount: number;          // 0 / 1 / 2
  wearerHands: WearerHandObservation[];
  /** Fraction of the frame covered by person pixels (0..1), from ARKit person segmentation. */
  segmentationCoverage: number;
  /** Fraction of person pixels sitting in the outer 8% band of the frame (0..1). */
  segmentationEdgeRatio: number;
}

/** Display orientation the native side rotates frames to. Capture is landscape-only. */
export type DisplayOrientation = 'landscapeLeft' | 'landscapeRight';

/** Handle for a hand-track subscription. */
export interface HandTrackSubscription {
  remove(): void;
}

/** Declares one file a recording config writes into the session dir. */
export interface OutputFileSpec {
  /** File name inside the session dir (uploaded under raw/<content_hash>/ with the same name). */
  name: string;
  /** Content-Type used for the upload. */
  contentType: string;
  /** true = required (upload fails loudly if missing);
   *  false = optional (uploaded when present, skipped when not). */
  required: boolean;
  /** Whether this MP4 is the primary video: the file the content hash is
   *  computed over and downstream processing targets (one per config). */
  isPrimaryVideo?: boolean;
}

/** Handle for a recording session. */
export interface RecordingSession {
  /** file:// URI of the directory the output files land in. */
  sessionDir: string;
}

/**
 * The recording-config abstraction. Differences between native capture stacks
 * (ARKit today, others later) are absorbed here; the UI drives recording
 * through this interface alone and never sees native details.
 */
export interface RecordingConfig {
  /** Unique id (stored as Clip.recordingConfigId). 'arkit' | ... */
  readonly id: string;
  /** Display name. */
  readonly label: string;
  readonly platform: 'ios' | 'android' | 'both';
  /** The files this config outputs (the upload step reads this). */
  readonly outputFiles: OutputFileSpec[];

  /** Whether this device supports the config. */
  isAvailable(): Promise<boolean>;

  /** Start the preview + sensor session (not recording yet). */
  startSession(sink: EventSink): Promise<void>;
  /** Tear the session down. */
  stopSession(sink: EventSink): Promise<void>;

  /** Start recording. Resolves to the output session dir. */
  startRecording(sink: EventSink): Promise<RecordingSession>;
  /** Stop recording. Resolves to the same session dir as startRecording. */
  stopRecording(sink: EventSink): Promise<RecordingSession>;

  /** file:// URI of the primary video (the MP4 the content hash is computed over). */
  primaryVideoUri(session: RecordingSession): string;

  // ─── Realtime surface (what the gesture UX sits on; config-independent) ─────
  /** Subscribe to realtime hand tracking (~15-30 Hz). */
  subscribeHandTrack(listener: (e: HandTrackEvent) => void): HandTrackSubscription;
  /** Write the latest frame to a temp JPEG and return its file:// URI. */
  captureSnapshot(): Promise<string>;
  /** Tell the native side the display orientation (fixed before recording starts). */
  setDisplayOrientation(orientation: DisplayOrientation): Promise<void>;
}

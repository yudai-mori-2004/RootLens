// Public API of the dataflow layer.
//
// The UI imports from here. No React bindings are included (this is a pure data
// layer); React subscribes via zustand's useStore(dataflowStore, selector) in
// the UI layer.
//
// ⚠ Dataflow layer: must not import react / react-native.

// Types
export type {
  Clip,
  ClipState,
  UploadStage,
  ServerClipStatus,
  HashResult,
  UploadInput,
  UploadResult,
  RegisterInput,
  RegisterResult,
} from './types';

// Events
export type { DataflowEvent, DataflowEventInput, EventSink, EventLevel } from './events';
export { makeEvent, noopSink, teeToConsole } from './events';

// Recording configs
export type {
  RecordingConfig,
  RecordingSession,
  OutputFileSpec,
  HandLandmark,
  WearerHandObservation,
  GestureKind,
  HandTrackEvent,
  DisplayOrientation,
  HandTrackSubscription,
  CaptureMethod,
  CaptureMethodId,
} from './recording-configs';
export {
  RECORDING_CONFIGS,
  CAPTURE_METHODS,
  DEFAULT_RECORDING_CONFIG,
  getRecordingConfig,
  getCaptureMethod,
  recordingConfigForMethod,
  listAvailableConfigs,
} from './recording-configs';

// Individual steps
export {
  computeContentHash,
  uploadToR2,
  registerClip,
  fetchMyClips,
  fetchClipMediaUrl,
  attachClipConsent,
  deleteServerClip,
  ClipApiError,
} from './steps';

// Stage-resumable upload runner (shared by "upload" and "try again": record → hash → upload + register)
export { enqueueRecording, enqueueAdvance, advanceClip, discardClip, recoverOrphanRecordings } from './pipeline';

// Store
export {
  dataflowStore,
  storeEventSink,
  clipList,
  selectClip,
  selectCurrentClip,
} from './store';
export type { DataflowState, RecordingPhase } from './store';

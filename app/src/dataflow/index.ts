// dataflow 層 (Layer 1) の公開 API。
//
// UI (Layer 3) はここから import する。 React binding は含まない (= 純粋データ層)。
// React からの購読は zustand の useStore(dataflowStore, selector) を UI 層で行う。
//
// ⚠ Layer 1 (dataflow)。react / react-native を import しない。

// 型
export type {
  Clip,
  ClipState,
  Pipeline1Stage,
  ServerClipStatus,
  SignInput,
  SignResult,
  UploadInput,
  UploadResult,
  RegisterInput,
  RegisterResult,
} from './types';

// イベント
export type { DataflowEvent, DataflowEventInput, EventSink, EventLevel } from './events';
export { makeEvent, noopSink, teeToConsole } from './events';

// 撮影構成
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
} from './recording-configs';
export {
  RECORDING_CONFIGS,
  DEFAULT_RECORDING_CONFIG,
  getRecordingConfig,
  listAvailableConfigs,
} from './recording-configs';

// 個別 step
export {
  signClip,
  signRecording,
  makeSignTmpDir,
  cleanupTmpDir,
  signedUriIn,
  uploadToR2,
  registerClip,
  fetchMyClips,
  persistClipThumbnail,
  thumbPath,
  listThumbHashes,
} from './steps';

// 段レジューム型ランナー (= 「送る」「もう一度試す」 統一。 撮影 → D1 → アップ + 登録)
export { enqueueRecording, advanceClip, discardClip } from './pipeline';

// store
export {
  dataflowStore,
  storeEventSink,
  clipList,
  selectClip,
  selectCurrentClip,
} from './store';
export type { DataflowState, RecordingPhase } from './store';

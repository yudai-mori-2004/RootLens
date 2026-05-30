// dataflow 層 (Layer 1) の公開 API。
//
// UI (Layer 3) はここから import する。 React binding は含まない (= 純粋データ層)。
// React からの購読は zustand の useStore(dataflowStore, selector) を UI 層で行う。
//
// ⚠ Layer 1 (dataflow)。react / react-native を import しない。

// 型
export type {
  Clip,
  ClipReward,
  ClipState,
  Pipeline1Stage,
  ProcessingStep,
  QualityBreakdown,
  Layer1Score,
  Layer2Score,
  Layer3Score,
  ServerClipStatus,
  SignInput,
  SignResult,
  UploadInput,
  UploadResult,
  TpInput,
  TpResult,
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
  makeSignTmpDir,
  cleanupTmpDir,
  captureSign,
  blurSign,
  uploadToR2,
  registerWithTitleProtocol,
  registerClip,
  fetchClipStatus,
  fetchClipStatusByHash,
  pollPipeline2,
  triggerPipeline3,
  fetchPipeline3Status,
  stakeClip,
  resolveServerClipId,
} from './steps';
export type { PollOptions, Pipeline3TriggerResult } from './steps';

// orchestrator (= 純粋 Pipeline 1: upload → TP/mint → register + finalize)
export { runPipeline1 } from './orchestrator';
export type { Pipeline1Input, Pipeline1Result } from './orchestrator';

// 段レジューム型ランナー (= 「送る」「もう一度試す」 統一。 撮影 → 署名段 → 登録 → Pipeline 2)
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

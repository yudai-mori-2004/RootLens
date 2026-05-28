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
  ProcessingStep,
  AutoCategory,
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
export type { RecordingConfig, RecordingSession, OutputFileSpec } from './recording-configs';
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
  uploadToR2,
  registerWithTitleProtocol,
  registerClip,
  fetchClipStatus,
  pollPipeline2,
  triggerPipeline3,
  fetchPipeline3Status,
} from './steps';
export type { PollOptions, Pipeline3TriggerResult } from './steps';

// orchestrator
export { runPipeline1 } from './orchestrator';
export type { Pipeline1Input, Pipeline1Result } from './orchestrator';

// store
export { dataflowStore, storeEventSink } from './store';
export type { DataflowState, RecordingPhase } from './store';

import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';
import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';

// Thin wrapper around the ARKit capture native module (modules/arkit-capture).
//
// startRecording takes a session directory and writes the recording outputs
// into it concurrently: rgb.mp4, frames.jsonl, imu.jsonl,
// metadata.json, and depth.tar on LiDAR devices.
//
// The module also emits realtime hand-detection results at ~15 Hz through the
// onHandTrack event.

export interface ArkitCapturePreviewProps extends ViewProps {}

// Guarded so importing this file does not crash when the native module is not
// in the build (e.g. Expo Go). When null, the UI shows a placeholder instead.
export const ArkitCapturePreviewView: ComponentType<ArkitCapturePreviewProps> | null = (() => {
  try {
    return requireNativeViewManager<ArkitCapturePreviewProps>('ArkitCapture');
  } catch {
    return null;
  }
})();

/** One hand landmark out of the 21 joints (MediaPipe order). */
export interface HandLandmark {
  x: number;        // 0..1, top-left origin
  y: number;        // 0..1
  confidence: number;
}

/** Detection result for one hand. */
export interface WearerHandObservation {
  handedness: 'left' | 'right' | 'unknown';
  confidence: number;
  landmarks: HandLandmark[];   // always 21 entries
  /** Per-hand gesture (native geometric heuristic; null when undecidable).
   *  Combining hands into a frame-level gesture happens on the TS side. */
  gesture: 'open_palm' | 'thumbs_up' | null;
}

/** Hand state for one frame. */
export interface HandTrackEvent {
  timestampNs: string;            // nanoseconds derived from ARFrame.timestamp (string for bigint safety)
  imageWidth: number;
  imageHeight: number;
  wearerHandCount: number;        // 0 / 1 / 2 (used only for gesture decisions)
  wearerHands: WearerHandObservation[];
  /** Fraction of the frame covered by "person" pixels, from ARKit person segmentation (0..1). */
  segmentationCoverage: number;
  /** Fraction of person pixels inside the outer 8% band of the frame (0..1). */
  segmentationEdgeRatio: number;
}

/** Display orientation. The native side (ARKit / Vision) interprets frames and
 *  corrects joint coordinates according to this value. Never change it while
 *  recording: the recorded camera intrinsics must stay valid for the whole clip. */
export type DisplayOrientation = 'portrait' | 'landscapeLeft' | 'landscapeRight';

/** Device thermal state (ProcessInfo.thermalState). At 'critical' the recording should be wound down. */
export type ThermalState = 'nominal' | 'fair' | 'serious' | 'critical' | 'unknown';

/** Battery level (0..1, -1 when unknown) and whether the device is charging. */
export interface PowerState {
  level: number;
  charging: boolean;
}

interface ArkitCaptureNativeModule {
  isAvailable(): Promise<boolean>;
  startSession(): Promise<void>;
  stopSession(): Promise<void>;
  /** Write rgb.mp4 + frames.jsonl + imu.jsonl + metadata.json
   *  concurrently under sessionDir. An empty string creates a session dir under
   *  temp. Resolves to the session dir's file:// URI. */
  startRecording(sessionDir: string): Promise<string>;
  /** Resolves to the same sessionDir passed to startRecording. */
  stopRecording(): Promise<string>;
  setCaptureSettings(json: string): Promise<void>;
  captureSnapshot(): Promise<string>;
  faststartMp4(inputPath: string, outputPath: string): Promise<string>;
  setDisplayOrientation(orientation: DisplayOrientation): Promise<void>;
  setScreenDimmed(dimmed: boolean): Promise<void>;
  setKeepAwake(on: boolean): Promise<void>;
  getThermalState(): Promise<ThermalState>;
  getPowerState(): Promise<PowerState>;
  getMemoryFootprintMB(): Promise<number>;
  startVoiceCommands(): Promise<void>;
  stopVoiceCommands(): Promise<void>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

const nativeModule = requireOptionalNativeModule<ArkitCaptureNativeModule>('ArkitCapture');

export async function isArkitCaptureAvailable(): Promise<boolean> {
  if (!nativeModule) return false;
  return nativeModule.isAvailable();
}

export async function startArkitSession(): Promise<void> {
  if (!nativeModule) throw new Error('ArkitCapture native module unavailable');
  return nativeModule.startSession();
}

export async function stopArkitSession(): Promise<void> {
  if (!nativeModule) throw new Error('ArkitCapture native module unavailable');
  return nativeModule.stopSession();
}

/** Write rgb.mp4 + frames.jsonl + imu.jsonl + metadata.json (plus
 *  depth.tar on LiDAR devices) concurrently under sessionDir. An empty string
 *  lets the native side create a fresh dir under temp. Resolves to the session
 *  dir's file:// URI. */
export async function startArkitRecording(sessionDir = ''): Promise<string> {
  if (!nativeModule) throw new Error('ArkitCapture native module unavailable');
  return nativeModule.startRecording(sessionDir);
}

export async function stopArkitRecording(): Promise<string> {
  if (!nativeModule) throw new Error('ArkitCapture native module unavailable');
  return nativeModule.stopRecording();
}

/** Pass capture settings (a JSON string) to the native side. They apply from
 *  the next startSession / startRecording. */
export async function setArkitCaptureSettings(json: string): Promise<void> {
  if (!nativeModule) return;
  return nativeModule.setCaptureSettings(json);
}

/** Write the current ARFrame to a temp JPEG and return its file:// URI. */
export async function captureArkitSnapshot(): Promise<string> {
  if (!nativeModule) throw new Error('ArkitCapture native module unavailable');
  return nativeModule.captureSnapshot();
}

/** Faststart an MP4 (move the moov atom to the front, no re-encode), write it
 *  to outputUri, and return that file:// URI. */
export async function faststartMp4(inputUri: string, outputUri: string): Promise<string> {
  if (!nativeModule) throw new Error('ArkitCapture native module unavailable');
  return nativeModule.faststartMp4(inputUri, outputUri);
}

/** Update the display orientation ARKit / Vision should assume. Called from the
 *  capture screen's ScreenOrientation listener. Settle the value before
 *  recording starts and never change it mid-recording (the recorded intrinsics
 *  must stay valid for the whole clip). */
export async function setArkitDisplayOrientation(orientation: DisplayOrientation): Promise<void> {
  if (!nativeModule) return;
  return nativeModule.setDisplayOrientation(orientation);
}

/** Screen off (power / heat relief for long recordings): brightness to zero and
 *  preview rendering paused. false restores. */
export async function setArkitScreenDimmed(dimmed: boolean): Promise<void> {
  if (!nativeModule) return;
  return nativeModule.setScreenDimmed(dimmed);
}

/** Suppress auto-lock (true while the capture screen is open). Controlled
 *  independently of the ARSession itself. */
export async function setArkitKeepAwake(on: boolean): Promise<void> {
  if (!nativeModule) return;
  return nativeModule.setKeepAwake(on);
}

/** Current thermal state. Changes during recording arrive via subscribeThermalState. */
export async function getArkitThermalState(): Promise<ThermalState> {
  if (!nativeModule) return 'unknown';
  return nativeModule.getThermalState();
}

/** Diagnostics: the app's memory footprint (phys_footprint, MB). -1 when unavailable. */
export async function getArkitMemoryFootprintMB(): Promise<number> {
  if (!nativeModule) return -1;
  return nativeModule.getMemoryFootprintMB();
}

/** Battery level and charging state. Drives the long-recording auto-stop. */
export async function getArkitPowerState(): Promise<PowerState> {
  if (!nativeModule) return { level: -1, charging: false };
  return nativeModule.getPowerState();
}

/** Thermal-state changes (fires while recording). */
export function subscribeThermalState(listener: (e: { state: ThermalState }) => void): { remove: () => void } {
  if (!nativeModule) return { remove: () => {} };
  const sub = (nativeModule as any).addListener?.('onThermalState', listener);
  if (sub && typeof sub.remove === 'function') return sub;
  return { remove: () => (nativeModule as any).removeListeners?.(1) };
}

/** Start listening for spoken start/stop commands (on-device speech recognition,
 *  ja-JP). Keywords are matched inside the recognizer; only matches surface as
 *  onVoiceCommand events. Audio is transcribed transiently and never stored. */
export async function startArkitVoiceCommands(): Promise<void> {
  if (!nativeModule) return;
  return nativeModule.startVoiceCommands();
}

export async function stopArkitVoiceCommands(): Promise<void> {
  if (!nativeModule) return;
  return nativeModule.stopVoiceCommands();
}

/** Spoken command matches ('start' | 'stop') with the raw transcript for debugging. */
export function subscribeVoiceCommand(
  listener: (e: { command: 'start' | 'stop'; transcript: string }) => void,
): { remove: () => void } {
  if (!nativeModule) return { remove: () => {} };
  const sub = (nativeModule as any).addListener?.('onVoiceCommand', listener);
  if (sub && typeof sub.remove === 'function') return sub;
  return { remove: () => (nativeModule as any).removeListeners?.(1) };
}

/** Voice listening stopped for good. On-device recognition rides on the OS
 *  dictation engine, so this fires when Siri and keyboard dictation are both
 *  disabled on the device (the only unrecoverable case seen in practice). */
export function subscribeVoiceUnavailable(
  listener: (e: { message: string }) => void,
): { remove: () => void } {
  if (!nativeModule) return { remove: () => {} };
  const sub = (nativeModule as any).addListener?.('onVoiceUnavailable', listener);
  if (sub && typeof sub.remove === 'function') return sub;
  return { remove: () => (nativeModule as any).removeListeners?.(1) };
}

/** Subscribe to hand tracking (fires at ~15 Hz). */
export function subscribeHandTrack(listener: (e: HandTrackEvent) => void): { remove: () => void } {
  if (!nativeModule) return { remove: () => {} };
  // expo-modules-core Modules implement the EventEmitter interface.
  const sub = (nativeModule as any).addListener?.('onHandTrack', listener);
  if (sub && typeof sub.remove === 'function') return sub;
  // Fallback for the older API shape.
  return { remove: () => (nativeModule as any).removeListeners?.(1) };
}

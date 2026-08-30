import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';
import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';

import type { HandTrackEvent } from '../dataflow/recording-configs/types';
import type {
  CameraImuTimeValidationResult,
  DisplayOrientation,
} from './arkitCapture';

export interface IphoneCapturePreviewProps extends ViewProps {}

export const IphoneCapturePreviewView: ComponentType<IphoneCapturePreviewProps> | null = (() => {
  try {
    return requireNativeViewManager<IphoneCapturePreviewProps>('IphoneCapture');
  } catch {
    return null;
  }
})();

interface IphoneCaptureNativeModule {
  isAvailable(): Promise<boolean>;
  startSession(): Promise<void>;
  stopSession(): Promise<void>;
  startRecording(sessionDir: string): Promise<string>;
  stopRecording(): Promise<string>;
  setCaptureSettings(json: string): Promise<void>;
  captureSnapshot(): Promise<string>;
  setDisplayOrientation(orientation: DisplayOrientation): Promise<void>;
  analyzeCameraImuTimeValidation(sessionDir: string): Promise<CameraImuTimeValidationResult>;
  getCameraImuTimeValidation(): Promise<CameraImuTimeValidationResult | null>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

const nativeModule = requireOptionalNativeModule<IphoneCaptureNativeModule>('IphoneCapture');

function requiredModule(): IphoneCaptureNativeModule {
  if (!nativeModule) throw new Error('IphoneCapture native module unavailable');
  return nativeModule;
}

export async function isIphoneCaptureAvailable(): Promise<boolean> {
  return nativeModule ? nativeModule.isAvailable() : false;
}

export async function startIphoneSession(): Promise<void> {
  return requiredModule().startSession();
}

export async function stopIphoneSession(): Promise<void> {
  return requiredModule().stopSession();
}

export async function startIphoneRecording(sessionDir = ''): Promise<string> {
  return requiredModule().startRecording(sessionDir);
}

export async function stopIphoneRecording(): Promise<string> {
  return requiredModule().stopRecording();
}

export async function setIphoneCaptureSettings(json: string): Promise<void> {
  if (!nativeModule) return;
  return nativeModule.setCaptureSettings(json);
}

export async function captureIphoneSnapshot(): Promise<string> {
  return requiredModule().captureSnapshot();
}

export async function setIphoneDisplayOrientation(orientation: DisplayOrientation): Promise<void> {
  if (!nativeModule) return;
  return nativeModule.setDisplayOrientation(orientation);
}

export async function analyzeIphoneCameraImuTimeValidation(
  sessionDir: string,
): Promise<CameraImuTimeValidationResult> {
  return requiredModule().analyzeCameraImuTimeValidation(sessionDir);
}

export async function getIphoneCameraImuTimeValidation(): Promise<CameraImuTimeValidationResult | null> {
  return nativeModule ? nativeModule.getCameraImuTimeValidation() : null;
}

export function subscribeIphoneHandTrack(
  listener: (event: HandTrackEvent) => void,
): { remove: () => void } {
  if (!nativeModule) return { remove: () => {} };
  const subscription = (nativeModule as any).addListener?.('onHandTrack', listener);
  if (subscription && typeof subscription.remove === 'function') return subscription;
  return { remove: () => (nativeModule as any).removeListeners?.(1) };
}

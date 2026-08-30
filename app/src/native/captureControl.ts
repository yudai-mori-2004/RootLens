import { requireOptionalNativeModule } from 'expo-modules-core';

interface CaptureControlNativeModule {
  isHardwareCaptureEventAvailable(): Promise<boolean>;
  startHardwareCaptureEvents(): Promise<void>;
  stopHardwareCaptureEvents(): Promise<void>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

const nativeModule = requireOptionalNativeModule<CaptureControlNativeModule>('CaptureControl');

/** AVCaptureEventInteraction is available from iOS 17.2. */
export async function isHardwareCaptureEventAvailable(): Promise<boolean> {
  return nativeModule ? nativeModule.isHardwareCaptureEventAvailable() : false;
}

/** Own iOS physical camera controls while the hardware-button flow is active. */
export async function startHardwareCaptureEvents(): Promise<void> {
  if (!nativeModule) throw new Error('CaptureControl native module unavailable');
  return nativeModule.startHardwareCaptureEvents();
}

export async function stopHardwareCaptureEvents(): Promise<void> {
  if (!nativeModule) return;
  return nativeModule.stopHardwareCaptureEvents();
}

/** The one-handler AVKit interaction maps both volume buttons to this event. */
export function subscribeHardwareCaptureEvent(listener: () => void): { remove: () => void } {
  if (!nativeModule) return { remove: () => {} };
  const subscription = (nativeModule as any).addListener?.('onHardwareCaptureEvent', listener);
  if (subscription && typeof subscription.remove === 'function') return subscription;
  return { remove: () => (nativeModule as any).removeListeners?.(1) };
}

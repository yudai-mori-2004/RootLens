// 撮影フローの registry。 新フローはここに登録する (= CaptureScreen は id でしか参照しない)。

import { gestureFlow } from './gestureFlow';
import { voiceFlow } from './voiceFlow';
import type { CaptureFlow, CaptureFlowId } from './types';

export * from './types';

export const CAPTURE_FLOWS: readonly CaptureFlow[] = [gestureFlow, voiceFlow];

export const DEFAULT_CAPTURE_FLOW_ID: CaptureFlowId = 'gesture';

export function getCaptureFlow(id: string | undefined): CaptureFlow {
  return CAPTURE_FLOWS.find((f) => f.id === id) ?? gestureFlow;
}

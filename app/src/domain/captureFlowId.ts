export const CAPTURE_FLOW_IDS = ['gesture', 'voice', 'hardware_button'] as const;

export type CaptureFlowId = (typeof CAPTURE_FLOW_IDS)[number];

export function isCaptureFlowId(value: unknown): value is CaptureFlowId {
  return typeof value === 'string' && (CAPTURE_FLOW_IDS as readonly string[]).includes(value);
}

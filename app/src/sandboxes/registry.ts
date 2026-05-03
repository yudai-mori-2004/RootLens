import type { ComponentType } from 'react';
import HandPoseScreen from './01-hand-pose-gesture/HandPoseScreen';

export interface SandboxEntry {
  id: string;
  title: string;
  description: string;
  screen: ComponentType<any>;
}

export const sandboxes: SandboxEntry[] = [
  {
    id: '01-hand-pose-gesture',
    title: '01: Hand Pose + Gesture',
    description: '21-joint hand pose (iOS Vision / MediaPipe) + start/end gesture detection',
    screen: HandPoseScreen,
  },
  // 02-vlm-task-gate, 03-video-imu-consistency は実装後に追加
];

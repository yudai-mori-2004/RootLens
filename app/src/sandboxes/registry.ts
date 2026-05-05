import type { ComponentType } from 'react';
import HandPoseScreen from './01-hand-pose-gesture/HandPoseScreen';
import TaskGateScreen from './02-vlm-task-gate/TaskGateScreen';

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
  {
    id: '02-vlm-task-gate',
    title: '02: VLM Task Gate',
    description: 'Snapshot → Gemini Robotics-ER 1.6 / Flash → match/confidence/reason',
    screen: TaskGateScreen,
  },
  // 03-video-imu-consistency は server-side Python pipeline (RN sandbox 対象外)
];

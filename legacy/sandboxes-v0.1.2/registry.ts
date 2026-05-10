import type { ComponentType } from 'react';
import HandPoseScreen from './01-hand-pose-gesture/HandPoseScreen';
import TaskGateScreen from './02-vlm-task-gate/TaskGateScreen';
import CollectionFlowScreen from './04-collection-flow/CollectionFlowScreen';
import PrivacyBlurScreen from './05-privacy-blur/PrivacyBlurScreen';

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
  {
    id: '04-collection-flow',
    title: '04: Collection Flow',
    description: 'タスク選択 → ジェスチャー連動 VLM 開始判定 → 録画 → 終了判定 (統合デモ)',
    screen: CollectionFlowScreen,
  },
  {
    id: '05-privacy-blur',
    title: '05: Privacy Blur (Unit C)',
    description: 'sandbox 内で録画 → 顔をオンデバイス blur (Vision + CoreImage + Metal)。text blur は別ユニットで対応',
    screen: PrivacyBlurScreen,
  },
];

// Navigation 型定義。
//
// アプリは大きく 2 階層:
//   • RootStack — Login (1 回だけ) → MainTabs (ベース) → 撮影フロー (Capture..Done)
//   • MainTabs  — Job / Collection / Settings の 3 タブ
//
// 撮影フローの screens は Tab の上に被せる stack screen にしてある。
// これでフロー中はタブバーが消え、Done で `popToTop` すると Job タブに戻る。

import type { VlmGateResult } from '../services/vlmGate';

export type RootStackParamList = {
  Login: undefined;
  Main: undefined; // MainTabs を埋め込むコンテナ画面
  Capture: { taskId: string };
  Review: {
    taskId: string;
    videoUri: string;
    vlmEnd: VlmGateResult | null;
    vlmEndError: string | null;
    durationMs: number;
  };
  SignAndMint: {
    taskId: string;
    processedVideoUri: string;
    originalVideoUri: string;
  };
  Stake: {
    taskId: string;
    rootNftAssetId: string;
    mintTxSignature: string;
    contentHash: string;
    publicUrl: string | null;
  };
  Done: {
    taskId: string;
    rootNftAssetId: string;
    contentHash: string;
    staked: boolean;
    stakeTxSignature: string | null;
  };
};

export type MainTabParamList = {
  Job: undefined;
  Collection: undefined;
  Settings: undefined;
};

// Root stack navigation 型。各 screen 間で渡すデータ。
//
// 流れ: Login → TaskList → Capture → Review → SignAndMint → Stake → Done

import type { VlmGateResult } from '../services/vlmGate';

export type RootStackParamList = {
  Login: undefined;
  TaskList: undefined;
  Capture: { taskId: string };
  Review: {
    taskId: string;
    /** Capture で出力された生 mp4 (file://) */
    videoUri: string;
    /** 終了時 VLM 判定結果 (フィードバック表示用) */
    vlmEnd: VlmGateResult | null;
    vlmEndError: string | null;
    durationMs: number;
  };
  SignAndMint: {
    taskId: string;
    /** Privacy blur 適用済 mp4 (file://)。blur skip 時は raw video と同じ */
    processedVideoUri: string;
    /** Blur 前の生 mp4 (デバッグ表示用、なくても可) */
    originalVideoUri: string;
  };
  Stake: {
    taskId: string;
    /** TP register が返した Root NFT asset id */
    rootNftAssetId: string;
    /** TP register tx signature */
    mintTxSignature: string;
    /** TP register が返した content_hash */
    contentHash: string;
    /** R2 公開 URL (オプション、確認用) */
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

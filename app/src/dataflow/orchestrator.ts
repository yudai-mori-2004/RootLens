// Pipeline 1 の連結 orchestrator (DATA_SPECS §2)。
//
//   runPipeline1   署名済みクリップ (= signature_hash 確定済み) を入力に upload → title-protocol →
//                  register + finalize を実行する。 hash で冪等 (= 再実行しても R2 上書き /
//                  既発行 cNFT 再利用 / clip 行重複排除)。
//
// ⚠ 署名 (D1 / blur+D2) は dataflow/pipeline.ts の advanceClip が段として実行し、 signature_hash を
//    確定させてから runPipeline1 を呼ぶ。 署名を runPipeline1 内に置かない理由: C2PA D2 は RFC3161
//    TSA タイムスタンプを埋めるため再署名で signature_hash が変わり、 hash ベース冪等が壊れ二重 mint する。
//    署名は段レジュームで「1 回だけ」 行い、 以降は同じ signature_hash を使い回す。
//
// ⚠ Layer 1 (dataflow)。react / react-native を import しない。

import * as FileSystem from 'expo-file-system';

import type { EventSink } from './events';
import type { RecordingConfig, RecordingSession } from './recording-configs';
import type { SignResult } from './types';
import { uploadToR2 } from './steps/upload';
import { registerWithTitleProtocol } from './steps/titleProtocol';
import { registerClip } from './steps/register';

export interface Pipeline1Input {
  config: RecordingConfig;
  session: RecordingSession;
  /** ぼかし署名段 (blurSign) で確定済みの署名結果 (= ここで再署名はしない)。 */
  signed: SignResult;
  /** Bubblegum cNFT 発行先 merkle tree pubkey */
  merkleTree: string;
  /** MPL Core collection (= public tree なら省略可) */
  collection?: string;
  /** 撮影ファクト (= POST /api/clips で申告)。 録画尺 (ms) と端末機種。 */
  durationMs?: number | null;
  deviceModel?: string | null;
}

export interface Pipeline1Result {
  clipId: string;
  signatureHash: string;
  contentSize: number;
  facesBlurred: number;
  rootAssetId: string;
  signedJsonUri: string;
  txSignature: string;
  walletPubkey: string;
}

/**
 * 署名済みクリップを upload → TP → register まで通し、 clip 登録 + Pipeline 2 起動まで行う。
 * 署名はしない (= ぼかし署名段で確定済みの input.signed を使う)。
 * signature_hash は固定なので再実行しても冪等: R2 は上書き、 cNFT は既発行なら再利用 (titleProtocol)、
 * clip 行は重複排除される。
 */
export async function runPipeline1(
  input: Pipeline1Input,
  sink: EventSink,
): Promise<Pipeline1Result> {
  const t0 = Date.now();
  const { signed } = input;

  // ─── upload (R2) ─────────────────────────────────────────────────
  // 撮影構成の outputFiles を名前 → ローカル URI に解決する。
  // primary video はぼかし+署名済 (signed.signedMp4Uri)、 それ以外は session dir のファイルをそのまま。
  const files: Record<string, string> = {};
  for (const spec of input.config.outputFiles) {
    const uri = spec.isPrimaryVideo
      ? signed.signedMp4Uri
      : `${input.session.sessionDir}${spec.name}`;
    // optional (required:false) なファイルは、 実際に生成された時だけ上げる
    // (= 例: depth.tar は LiDAR 機でしか作られない)。
    if (!spec.required) {
      const info = await FileSystem.getInfoAsync(uri);
      if (!info.exists) {
        sink({ step: 'r2-upload', level: 'info', message: `${spec.name} は未生成のため skip (optional)` });
        continue;
      }
    }
    files[spec.name] = uri;
  }
  await uploadToR2({ signatureHash: signed.signatureHash, files }, sink);

  // ─── title-protocol (TP /process + cNFT mint、 既発行なら mint をスキップして再利用) ───
  const tp = await registerWithTitleProtocol(
    { signatureHash: signed.signatureHash, merkleTree: input.merkleTree, collection: input.collection },
    sink,
  );

  // ─── register (POST /api/clips + finalize → Pipeline 2 起動) ─────
  const reg = await registerClip(
    {
      signatureHash: signed.signatureHash,
      contentSize: signed.contentSize,
      rootAssetId: tp.rootAssetId,
      signedJsonUri: tp.signedJsonUri,
      walletPubkey: tp.walletPubkey,
      recordingConfig: input.config.id,
      durationMs: input.durationMs,
      deviceModel: input.deviceModel,
    },
    sink,
  );

  sink({
    step: 'pipeline1',
    level: 'success',
    message: `Pipeline 1 完走 (${Date.now() - t0}ms) clip=${reg.clipId}`,
    detail: { clipId: reg.clipId, signatureHash: signed.signatureHash, rootAssetId: tp.rootAssetId },
  });

  return {
    clipId: reg.clipId,
    signatureHash: signed.signatureHash,
    contentSize: signed.contentSize,
    facesBlurred: signed.facesBlurred,
    rootAssetId: tp.rootAssetId,
    signedJsonUri: tp.signedJsonUri,
    txSignature: tp.txSignature,
    walletPubkey: tp.walletPubkey,
  };
}

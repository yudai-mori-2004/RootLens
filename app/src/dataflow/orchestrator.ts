// Pipeline 1 の連結 orchestrator (DATA_SPECS §2)。
//
// 録画済み session を入力に、 sign → upload → title-protocol → register を順に実行する。
// 各 step は単独でも呼べる純粋関数 (steps/*)。 ここはそれを「録画後の全自動フロー」として束ねるだけ。
// sandbox の「Pipeline 2 送信」ボタンや、 将来の本番 capture flow がこれを呼ぶ。
//
// 録画 (record) はこの orchestrator に含めない: 録画開始/停止は UI のジェスチャー/ボタンが
// 駆動する別ライフサイクルであり、 ここは「録画済みデータをサーバ登録まで届ける」責務に閉じる。
//
// ⚠ Layer 1 (dataflow)。react / react-native を import しない。

import type { EventSink } from './events';
import type { RecordingConfig, RecordingSession } from './recording-configs';
import { signClip, makeSignTmpDir, cleanupTmpDir } from './steps/sign';
import { uploadToR2 } from './steps/upload';
import { registerWithTitleProtocol } from './steps/titleProtocol';
import { registerClip } from './steps/register';

export interface Pipeline1Input {
  config: RecordingConfig;
  session: RecordingSession;
  /** Bubblegum cNFT 発行先 merkle tree pubkey */
  merkleTree: string;
  /** MPL Core collection (= public tree なら省略可) */
  collection?: string;
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
 * 録画済み session を sign → upload → TP → register まで通し、 clip 登録 + Pipeline 2 起動まで行う。
 * 完走/失敗いずれでも sign の一時ファイルは cleanup する。
 */
export async function runPipeline1(
  input: Pipeline1Input,
  sink: EventSink,
): Promise<Pipeline1Result> {
  const t0 = Date.now();
  const rawMp4Uri = input.config.primaryVideoUri(input.session);

  const tmpDir = await makeSignTmpDir();
  try {
    // ─── sign (D1 + blur + D2 + signature_hash) ─────────────────────────
    const signed = await signClip({ rawMp4Uri }, tmpDir, sink);

    // ─── upload (R2) ─────────────────────────────────────────────────
    // 撮影構成の outputFiles を名前 → ローカル URI に解決する。
    // primary video はぼかし+署名済 (signedMp4Uri)、 それ以外は session dir のファイルをそのまま。
    const files: Record<string, string> = {};
    for (const spec of input.config.outputFiles) {
      if (spec.isPrimaryVideo) {
        files[spec.name] = signed.signedMp4Uri;
      } else {
        files[spec.name] = `${input.session.sessionDir}${spec.name}`;
      }
    }
    await uploadToR2({ signatureHash: signed.signatureHash, files }, sink);

    // ─── title-protocol (TP /process + cNFT mint) ───────────────────
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
  } finally {
    await cleanupTmpDir(tmpDir);
  }
}

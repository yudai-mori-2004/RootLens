// Pipeline 1 step: C2PA 署名 + 顔ぼかし (DATA_SPECS §2.3 / §2.4)。
//
//   1. C2PA D1 署名      生 MP4 → c2pa.actions.v2 [c2pa.created]
//   2. Apple Vision ぼかし  顔を Gaussian blur
//   3. C2PA D2 署名      D1 を ingredient parentOf 参照、 ぼかし action 記載
//   4. signature_hash 抽出    SHA-256(D2 active manifest signature)
//
// 出力 signedMp4Uri は R2 に rgb.mp4 として上げる本体。
// 一時ファイルは tmp dir に作り、 呼び出し側が完走/失敗後に cleanup する責務 (= cleanupTmpDir)。
//
// ⚠ Layer 1 (dataflow)。react / react-native を import しない。
//    FileSystem (expo) / native bridge の関数 export のみ使う。

import * as FileSystem from 'expo-file-system';

import { signD1, signD2, computeSignatureHash } from '../../native/c2paBridge';
import { processPrivacyBlur } from '../../units/privacy-blur';
import type { EventSink } from '../events';
import type { SignInput, SignResult } from '../types';

/** sign step 用の一時作業 dir を作る。 返値を cleanupTmpDir に渡して片付ける。 */
export async function makeSignTmpDir(): Promise<string> {
  const tmpDir = `${FileSystem.cacheDirectory}dataflow-sign-${Date.now()}/`;
  await FileSystem.makeDirectoryAsync(tmpDir, { intermediates: true });
  return tmpDir;
}

export async function cleanupTmpDir(tmpDir: string): Promise<void> {
  try {
    await FileSystem.deleteAsync(tmpDir, { idempotent: true });
  } catch {
    // cleanup 失敗は致命ではない
  }
}

/**
 * 生 MP4 → D1 → ぼかし → D2 → signature_hash。
 *
 * @param tmpDir makeSignTmpDir() で作った作業 dir。 中間/最終ファイルをここに置く。
 *               呼び出し側が完走後 cleanupTmpDir すること。
 */
export async function signClip(
  input: SignInput,
  tmpDir: string,
  sink: EventSink,
): Promise<SignResult> {
  // ─── Step 1: D1 sign ──────────────────────────────────────────────
  sink({ step: 'sign-d1', level: 'info', message: 'C2PA D1 署名 (生 MP4)' });
  const d1Path = `${tmpDir}d1.mp4`;
  await signD1(input.rawMp4Uri, d1Path);
  sink({ step: 'sign-d1', level: 'success', message: 'D1 署名完了' });

  // ─── Step 2: 顔ぼかし ─────────────────────────────────────────────
  sink({ step: 'blur', level: 'info', message: 'Apple Vision 顔ぼかし' });
  const blurResult = await processPrivacyBlur({
    inputUri: d1Path,
    outputUri: `${tmpDir}blurred.mp4`,
  });
  sink({
    step: 'blur',
    level: 'success',
    message: `ぼかし完了: ${blurResult.facesBlurred} 顔 / ${blurResult.framesProcessed} フレーム`,
    detail: { facesBlurred: blurResult.facesBlurred, framesProcessed: blurResult.framesProcessed },
  });

  // ─── Step 3: D2 sign (parentOf D1) ───────────────────────────────
  sink({ step: 'sign-d2', level: 'info', message: 'C2PA D2 署名 (ぼかし済、 D1 を ingredient 参照)' });
  const d2Path = `${tmpDir}d2.mp4`;
  await signD2(blurResult.outputUri, d1Path, d2Path, blurResult.facesBlurred);
  sink({ step: 'sign-d2', level: 'success', message: 'D2 署名完了' });

  // ─── Step 4: signature_hash 抽出 ──────────────────────────────────────
  sink({ step: 'signature-hash', level: 'info', message: 'signature_hash 抽出 (SHA-256 of D2 active manifest)' });
  const signatureHashFull = await computeSignatureHash(d2Path);
  if (!signatureHashFull.startsWith('sha256:')) {
    throw new Error(`unexpected signature_hash format: ${signatureHashFull}`);
  }
  const signatureHash = signatureHashFull.slice('sha256:'.length);

  // D2 MP4 を最終アップロード名 rgb.mp4 として配置 (= upload step の入力)
  const signedMp4Uri = `${tmpDir}rgb.mp4`;
  await FileSystem.copyAsync({ from: d2Path, to: signedMp4Uri });
  const mp4Info = await FileSystem.getInfoAsync(signedMp4Uri, { size: true });
  if (!mp4Info.exists) throw new Error('D2 mp4 missing after copy');
  const contentSize = (mp4Info as { size?: number }).size ?? 0;

  sink({
    step: 'signature-hash',
    level: 'success',
    message: `signature_hash 確定: ${signatureHash}`,
    detail: { signatureHash, contentSize },
  });

  return {
    signedMp4Uri,
    signatureHash,
    contentSize,
    facesBlurred: blurResult.facesBlurred,
  };
}

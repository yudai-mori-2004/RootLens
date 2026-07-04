// Pipeline 1 step: C2PA D1 署名 (DATA_SPECS §2.3)。
//
//   1. C2PA D1 リモート署名   生 MP4 → c2pa.actions.v2 [c2pa.created]
//      (= ハッシュ計算はローカル、 COSE 署名だけサーバ /api/v1/c2pa-sign の組織鍵。 Adobe 方式)
//   2. signature_hash 抽出   SHA-256(D1 active manifest signature)
//
// 出力 signedMp4Uri は R2 に rgb.mp4 として上げる本体 (= blur 無しの本当の raw)。
// 署名は「アップロードする」 押下後に走るのでオンライン前提で良い (= 直後に R2 PUT もする)。
//
// 中間ファイルは workDir に作り、 呼び出し側が登録後に cleanup する責務 (= cleanupTmpDir)。
//
// ⚠ Layer 1 (dataflow)。react / react-native を import しない。
//    FileSystem (expo) / native bridge の関数 export のみ使う。

import * as FileSystem from 'expo-file-system';

import { SERVER_URL } from '../../env';
import { getCurrentSession } from '../../services/auth/instance';
import { signD1, computeSignatureHash } from '../../native/c2paBridge';
import type { EventSink } from '../events';
import type { SignInput, SignResult } from '../types';

const SIGN_SERVICE_URL = `${SERVER_URL}/api/v1/c2pa-sign`;

function accountPubkeyOrThrow(): string {
  const session = getCurrentSession();
  if (!session) throw new Error('未認証: session がありません (= AuthGate を通っていない)');
  return session.pubkey;
}

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

const SIGNED_NAME = 'rgb.mp4';

/** workDir 内の D1 署名済 MP4 (= 段レジュームの再開点が参照する固定名)。 */
export function signedUriIn(workDir: string): string {
  return `${workDir}${SIGNED_NAME}`;
}

/**
 * 撮影署名 (= D1)。 生 MP4 → D1 署名 → signature_hash → workDir/rgb.mp4。
 * 段 'unsigned' → 'signed' の遷移で実行する (= 失敗時はこの段から再開)。
 * signature_hash はここで初めて確定する。
 */
export async function signRecording(
  rawMp4Uri: string,
  workDir: string,
  sink: EventSink,
): Promise<SignResult> {
  // ─── D1 リモート署名 ──────────────────────────────────────────────
  sink({ step: 'sign-d1', level: 'info', message: 'C2PA D1 署名 (リモート署名 = サーバ組織鍵)' });
  const signedMp4Uri = signedUriIn(workDir);
  await signD1(rawMp4Uri, signedMp4Uri, SIGN_SERVICE_URL, accountPubkeyOrThrow());
  sink({ step: 'sign-d1', level: 'success', message: 'D1 署名完了' });

  // ─── signature_hash 抽出 ──────────────────────────────────────────
  sink({ step: 'signature-hash', level: 'info', message: 'signature_hash 抽出 (SHA-256 of D1 active manifest)' });
  const signatureHashFull = await computeSignatureHash(signedMp4Uri);
  if (!signatureHashFull.startsWith('sha256:')) {
    throw new Error(`unexpected signature_hash format: ${signatureHashFull}`);
  }
  const signatureHash = signatureHashFull.slice('sha256:'.length);

  const mp4Info = await FileSystem.getInfoAsync(signedMp4Uri, { size: true });
  if (!mp4Info.exists) throw new Error('signed mp4 missing');
  const contentSize = (mp4Info as { size?: number }).size ?? 0;

  sink({
    step: 'signature-hash',
    level: 'success',
    message: `signature_hash 確定: ${signatureHash}`,
    detail: { signatureHash, contentSize },
  });

  return { signedMp4Uri, signatureHash, contentSize };
}

/**
 * 単発実行用ラッパ (= 旧 signClip)。 内部 tmpDir を作って signRecording を呼ぶ。
 *
 * @param tmpDir makeSignTmpDir() で作った作業 dir。 中間/最終ファイルをここに置く。
 *               呼び出し側が完走後 cleanupTmpDir すること。
 */
export async function signClip(
  input: SignInput,
  tmpDir: string,
  sink: EventSink,
): Promise<SignResult> {
  return signRecording(input.rawMp4Uri, tmpDir, sink);
}

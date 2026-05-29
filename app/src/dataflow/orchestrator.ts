// Pipeline 1 の連結 orchestrator (DATA_SPECS §2)。
//
// 責務分割:
//   signRecording  撮影停止直後に「1 回だけ」実行する署名 (= D1 + blur + D2 + signature_hash)。
//                  署名済み MP4 を session dir に永続化する。 撮影ライフサイクルの一部。
//   runPipeline1   署名済みクリップを入力に upload → title-protocol → register を実行する。
//                  hash で冪等 (= 再実行しても上書き / 重複排除 / 既発行 cNFT 再利用)。
//
// ⚠ 署名と Pipeline 1 を分ける理由: C2PA D2 署名は RFC3161 TSA タイムスタンプ (sigTst2) を
//    埋め込むため、 同じ動画でも署名のたびに署名バイト列 → signature_hash が変わる。 署名を
//    runPipeline1 (= ボタン再押下で再実行されうる) の中に置くと毎回別ハッシュになり、 hash ベースの
//    冪等 (= 重複排除・既発行 cNFT 再利用) が一切効かず二重 mint する。 署名は「撮影終了時に 1 回」。
//
// ⚠ Layer 1 (dataflow)。react / react-native を import しない。

import * as FileSystem from 'expo-file-system';

import type { EventSink } from './events';
import type { RecordingConfig, RecordingSession } from './recording-configs';
import type { SignResult } from './types';
import { signClip, makeSignTmpDir } from './steps/sign';
import { uploadToR2 } from './steps/upload';
import { registerWithTitleProtocol } from './steps/titleProtocol';
import { registerClip } from './steps/register';

export interface Pipeline1Input {
  config: RecordingConfig;
  session: RecordingSession;
  /** 撮影停止時に signRecording で確定済みの署名結果 (= ここで再署名はしない)。 */
  signed: SignResult;
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
 * 撮影停止直後に「1 回だけ」実行する署名。 生 MP4 → D1 → ぼかし → D2 → signature_hash を確定する。
 * 署名済み MP4 (= signedMp4Uri) を以降の runPipeline1 (= 再押下されうる) が使い回すため、
 * 署名 tmpDir は cleanup せずに残す。 中間ファイル (d1 / blurred / d2) だけ消して署名済み rgb.mp4 を残す。
 *
 * ⚠ session dir (= native が tmp/ に作る録画 dir) へコピーしようとすると copyAsync が失敗したため、
 *    expo cache 配下の署名 dir にそのまま残す方式にした (= クロスディレクトリ copy を避ける)。
 */
export async function signRecording(
  config: RecordingConfig,
  session: RecordingSession,
  sink: EventSink,
): Promise<SignResult> {
  const rawMp4Uri = config.primaryVideoUri(session);
  const tmpDir = await makeSignTmpDir();
  const signed = await signClip({ rawMp4Uri }, tmpDir, sink);
  // 中間ファイルだけ削除して署名済み rgb.mp4 (= signed.signedMp4Uri) を残す。 tmpDir 自体は残す。
  for (const name of ['d1.mp4', 'blurred.mp4', 'd2.mp4']) {
    await FileSystem.deleteAsync(`${tmpDir}${name}`, { idempotent: true }).catch(() => {});
  }
  return signed;
}

/**
 * 署名済みクリップを upload → TP → register まで通し、 clip 登録 + Pipeline 2 起動まで行う。
 * 署名はしない (= signRecording で確定済みの input.signed を使う)。
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

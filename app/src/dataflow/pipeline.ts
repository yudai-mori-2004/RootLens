// Pipeline 1 の段レジューム型ランナー (= 「送る」 と 「もう一度試す」 を統一する単一の前進関数)。
//
// クリップは撮影時に local id で 'unsigned' として生まれ、 各段の成果物をローカル作業 dir に
// 残しながら前進する。 advanceClip はクリップの現在 stage を見て、 未完の段から成功済みの
// 中間成果物を再利用して前進するだけ。 初回投入も再試行も同じ advanceClip 1 本 (= submit/retry の別実装を持たない)。
//
//   未署名 (unsigned)        → 撮影署名 (D1)       → 'capture-signed'
//   撮影署名済 (capture-signed) → ぼかし+D2 署名      → 'blur-signed' (= signature_hash 誕生、 local id → hash に re-key)
//   ぼかし署名済 (blur-signed)  → upload+TP/mint+登録 → 'registered'  (= Pipeline 2 起動)
//   登録済 (registered)         → (端末側はここまで。 Pipeline 2 のユーザー再試行は無し)
//
// 冪等性: 'blur-signed' 以降は同じ signature_hash を使い回す (= 再署名しない) ので、 TP register の
// mint 前冪等チェック (= (wallet, signature_hash, network)) が効き二重 mint を防ぐ。
//
// ⚠ Layer 1 (dataflow)。react / react-native を import しない。

import * as FileSystem from 'expo-file-system';

import type { EventSink, DataflowEventInput } from './events';
import { getRecordingConfig, type RecordingConfig, type RecordingSession } from './recording-configs';
import type { Pipeline1Stage, SignResult } from './types';
import { captureSign, blurSign, cleanupTmpDir, d1UriIn, signedUriIn } from './steps/sign';
import { runPipeline1 } from './orchestrator';
import { pollPipeline2 } from './steps/pipeline2';
import { dataflowStore, makeLocalClipId } from './store';
import { MERKLE_TREE, MERKLE_COLLECTION } from '../env';

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try { return JSON.stringify(e); } catch { return String(e); }
}

async function exists(uri: string): Promise<boolean> {
  try {
    return (await FileSystem.getInfoAsync(uri)).exists;
  } catch {
    return false;
  }
}

/** Pipeline 1 の step 名 → uploadProgress (0..1) の段階写像。 */
function stepProgress(step: string): number | null {
  switch (step) {
    case 'r2-upload':     return 0.55;
    case 'tp-process':    return 0.7;
    case 'cnft-mint':     return 0.85;
    case 'register-clip': return 0.92;
    case 'finalize':      return 0.97;
    case 'pipeline1':     return 1.0;
    default:              return null;
  }
}

/**
 * 撮影完了時にクリップを起こす (= stage 'unsigned' で local id 採番、 作業 dir 作成)。
 * 以降は advanceClip で前進させる。 返値は local clip id。
 */
export async function enqueueRecording(input: {
  config: RecordingConfig;
  session: RecordingSession;
  /** 撮影ファクト (= UI 層で計測)。 録画尺 (ms、 stop−start) と端末機種。 */
  durationMs?: number | null;
  deviceModel?: string | null;
}): Promise<string> {
  const localId = makeLocalClipId();
  // 署名中間物 (d1.mp4 / 署名済 rgb.mp4) は録画と同じ durable な clip dir 配下 (sign/) に置く。
  // こうすると app-kill 後も raw + 中間物が揃って残り、 advanceClip が段から正確に再開できる。
  const workDir = `${input.session.sessionDir}sign/`;
  await FileSystem.makeDirectoryAsync(workDir, { intermediates: true }).catch(() => {});
  const store = dataflowStore.getState();
  store.upsertClip({
    id: localId,
    state: 'uploading',
    createdAt: Date.now(),
    recordingConfigId: input.config.id,
    durationMs: input.durationMs ?? null,
    deviceModel: input.deviceModel ?? null,
    sessionDir: input.session.sessionDir,
    stage: 'unsigned',
    workDir,
    uploadProgress: 0,
  });
  store.setCurrentClipId(localId);
  return localId;
}

/**
 * クリップの現在 stage から実際に再開できる stage を返す (= 中間成果物の欠落をチェックして降格)。
 * 例: 'blur-signed' でも署名済 rgb.mp4 が消えていれば d1 から、 それも無ければ生から再署名する。
 */
async function effectiveStage(stage: Pipeline1Stage, workDir: string | undefined): Promise<Pipeline1Stage> {
  if (stage === 'registered') return 'registered';
  if (stage === 'blur-signed') {
    if (workDir && (await exists(signedUriIn(workDir)))) return 'blur-signed';
  }
  if (stage === 'blur-signed' || stage === 'capture-signed') {
    if (workDir && (await exists(d1UriIn(workDir)))) return 'capture-signed';
  }
  return 'unsigned';
}

/**
 * クリップを現在 stage から前進させる (= submit / retry 共通)。 失敗段で error にして止め、
 * 成功段で stage を進める。 'blur-signed' で signature_hash に re-key し、 'registered' で Pipeline 2 を起動 + polling。
 */
export async function advanceClip(clipId: string, sink: EventSink): Promise<void> {
  const initial = dataflowStore.getState().clips[clipId];
  if (!initial) return;

  const config = initial.recordingConfigId ? getRecordingConfig(initial.recordingConfigId) : undefined;
  if (!config || !initial.sessionDir || !initial.workDir) {
    dataflowStore.getState().patchClip(clipId, {
      state: 'error',
      errorMessage: 'クリップのメタ情報 (撮影構成 / session / 作業 dir) が不足し再開できません',
    });
    return;
  }
  const session: RecordingSession = { sessionDir: initial.sessionDir };
  const workDir = initial.workDir;

  dataflowStore.getState().setCurrentClipId(clipId);
  dataflowStore.getState().patchClip(clipId, { state: 'uploading', errorMessage: null });

  try {
    let stage = await effectiveStage(initial.stage ?? 'unsigned', workDir);

    // ─── 未署名 → 撮影署名済み (D1) ───────────────────────────────────
    if (stage === 'unsigned') {
      const rawMp4Uri = config.primaryVideoUri(session);
      await captureSign(rawMp4Uri, workDir, sink);
      dataflowStore.getState().patchClip(clipId, { stage: 'capture-signed', uploadProgress: 0.2 });
      stage = 'capture-signed';
    }

    // ─── 撮影署名済み → ぼかし署名済み (blur + D2 → signature_hash 誕生) ──────
    if (stage === 'capture-signed') {
      const signed = await blurSign(workDir, sink);
      // identity 誕生: local id (or 旧 hash) → 新 signature_hash に re-key。
      dataflowStore.getState().renameClipId(clipId, signed.signatureHash);
      clipId = signed.signatureHash;
      dataflowStore.getState().patchClip(clipId, {
        stage: 'blur-signed',
        signatureHash: signed.signatureHash,
        contentSize: signed.contentSize,
        facesBlurred: signed.facesBlurred,
        uploadProgress: 0.4,
      });
      stage = 'blur-signed';
    }

    // ─── ぼかし署名済み → 登録済み (upload + TP/mint + register + finalize) ─────
    if (stage === 'blur-signed') {
      const cur = dataflowStore.getState().clips[clipId];
      if (!cur?.signatureHash) throw new Error('signature_hash 未確定で登録段に進めません');
      const signed: SignResult = {
        signedMp4Uri: signedUriIn(workDir),
        signatureHash: cur.signatureHash,
        contentSize: cur.contentSize ?? 0,
        facesBlurred: cur.facesBlurred ?? 0,
      };
      // step イベントを覗いて uploadProgress を進めつつ本来の sink にも流す。
      const targetId = clipId;
      const progressSink: EventSink = (e: DataflowEventInput) => {
        sink(e);
        const p = stepProgress(e.step);
        if (p != null && e.level !== 'error') {
          dataflowStore.getState().patchClip(targetId, { uploadProgress: p });
        }
      };
      const result = await runPipeline1(
        {
          config, session, signed,
          merkleTree: MERKLE_TREE, collection: MERKLE_COLLECTION,
          durationMs: cur.durationMs, deviceModel: cur.deviceModel,
        },
        progressSink,
      );
      dataflowStore.getState().patchClip(clipId, {
        stage: 'registered',
        rootAssetId: result.rootAssetId,
        signedJsonUri: result.signedJsonUri,
        txSignature: result.txSignature,
        state: 'processing',
        uploadProgress: 1,
      });
      // R2 アップロード済み = durable な clip dir (raw + 署名中間物 sign/) ごと片付ける。
      await cleanupTmpDir(session.sessionDir);

      // Pipeline 2 を polling (= server サロゲート id で GET、 store は signature_hash でキー)。
      await pollPipeline2(result.clipId, result.walletPubkey, sink, {
        onStatus: (s) => dataflowStore.getState().applyServerStatus(clipId, s),
      });
      return;
    }

    // ─── 登録済み: 端末側 Pipeline 1 は完了。 Pipeline 2 のユーザー再試行は行わない (= server ops)。
    // (= ここに来るのは登録済みクリップで advanceClip を呼んだ場合のみ。 何もしない)
  } catch (e) {
    dataflowStore.getState().patchClip(clipId, { state: 'error', errorMessage: errMsg(e) });
  }
}

/**
 * クリップを破棄する (= ローカル削除)。 durable な clip dir (録画 + 署名中間物) も掃除して
 * Documents にゴミを残さない。 サーバ DELETE は叩かない (= 現行挙動踏襲)。
 */
export async function discardClip(clipId: string): Promise<void> {
  const clip = dataflowStore.getState().clips[clipId];
  if (clip?.sessionDir) await cleanupTmpDir(clip.sessionDir);
  dataflowStore.getState().removeClip(clipId);
}

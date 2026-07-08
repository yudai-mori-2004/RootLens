// Pipeline 1 の段レジューム型ランナー (= 「送る」 と 「もう一度試す」 を統一する単一の前進関数)。
//
// v0.1.4: 段を 3 つに縮小 (= 旧 4 段から blur+D2 段を撤去)。
//
//   未署名 (unsigned)   → C2PA D1 署名         → 'signed' (= signature_hash 誕生、 local id → hash に re-key)
//   署名済 (signed)     → upload + POST /api/clips → 'registered' (= state='uploaded')
//   登録済 (registered) → (端末側はここまで)
//
// 冪等性: 'signed' 以降は同じ signature_hash を使い回す (= 再署名しない)。 サーバ側の重複排除
// (= (account, signature_hash)) が効いて二重 clip 行を防ぐ。
//
// ⚠ Layer 1 (dataflow)。react / react-native を import しない。

import * as FileSystem from 'expo-file-system';

import type { EventSink, DataflowEventInput } from './events';
import { getRecordingConfig, type RecordingConfig, type RecordingSession } from './recording-configs';
import type { Pipeline1Stage } from './types';
import { signRecording, cleanupTmpDir, signedUriIn } from './steps/sign';
import { uploadToR2 } from './steps/upload';
import { registerClip } from './steps/register';
import { dataflowStore, makeLocalClipId } from './store';
import { getCurrentSession } from '../services/auth/instance';

function getAccountPubkey(): string {
  const session = getCurrentSession();
  if (!session) throw new Error('未認証: session がありません (= AuthGate を通っていない)');
  return session.pubkey;
}

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

/** Pipeline 1 の step 名 → uploadProgress (0..1) の段階写像。
 *  r2-upload 区間はここでは固定値にせず (= null)、 実バイト進捗で 0.4→0.97 を滑らかに埋める
 *  (= uploadToR2 の onProgress。 一番長いアップロードが飛び飛びにならないように)。 */
function stepProgress(step: string): number | null {
  switch (step) {
    case 'sign-d1':       return 0.2;
    case 'signature-hash': return 0.35;
    case 'register-clip': return 1.0;
    default:              return null;
  }
}

/** アップロードの実バイト進捗 (0..1) を uploadProgress の 0.4→0.97 区間に写す。 */
function uploadFractionToProgress(f: number): number {
  return 0.4 + Math.max(0, Math.min(1, f)) * 0.57;
}

/**
 * 撮影完了時にクリップを起こす (= state 'recorded' + stage 'unsigned' で local id 採番)。
 * v0.1.4: ここでは自動アップロードしない。 ユーザーが一覧 (マイビデオ) でプレビューを確認し
 * 「アップロード」 を押した時に advanceClip が 署名 → R2 → 登録 を進める。
 */
export async function enqueueRecording(input: {
  config: RecordingConfig;
  session: RecordingSession;
  /** 撮影ファクト (= UI 層で計測)。 録画尺 (ms、 stop−start) と端末機種。 */
  durationMs?: number | null;
  deviceModel?: string | null;
}): Promise<string> {
  const localId = makeLocalClipId();
  // 署名中間物 (rgb.mp4) は録画と同じ durable な clip dir 配下 (sign/) に置く。
  // こうすると app-kill 後も raw + 中間物が揃って残り、 advanceClip が段から正確に再開できる。
  const workDir = `${input.session.sessionDir}sign/`;
  await FileSystem.makeDirectoryAsync(workDir, { intermediates: true }).catch(() => {});
  const store = dataflowStore.getState();
  store.upsertClip({
    id: localId,
    state: 'recorded',
    createdAt: Date.now(),
    recordingConfigId: input.config.id,
    durationMs: input.durationMs ?? null,
    deviceModel: input.deviceModel ?? null,
    sessionDir: input.session.sessionDir,
    stage: 'unsigned',
    workDir,
  });
  store.setCurrentClipId(localId);
  return localId;
}

// ─── 孤児録画の回収 (= 起動時に 1 回) ─────────────────────────────────
//
// 台帳登録 (enqueueRecording) は正常な停止フローでしか走らないので、 電池切れ・クラッシュ・
// OS kill で死んだ録画は Documents/recordings/ にファイルだけ残って一覧に出ない。 rgb.mp4 は
// fragmented MP4 (= 10 秒粒度で確定) なので途中死でも読める → 起動時に走査して台帳に戻す。
// 逆に録画として成立していない残骸 (mp4 が無い / 小さすぎる) はここで掃除する。
//
// ⚠ アップロード完了済みクリップは dir ごと掃除される (= cleanupTmpDir) 前提。 もし掃除に失敗した
//    dir が残っていると再回収して二重になるが、 それは掃除失敗というバグの顕在化であって隠さない。

const MIN_RECOVERABLE_MP4_BYTES = 3 * 1024 * 1024; // ~2 秒未満の録画は回収する価値が無い

/** file:// URI → Documents 起点の相対 path (= コンテナ UUID / private prefix の揺れを無視して比較する)。 */
function docRelative(uri: string | undefined): string | null {
  if (!uri) return null;
  const i = uri.indexOf('/Documents/');
  return i >= 0 ? uri.slice(i + '/Documents/'.length).replace(/\/+$/, '') : null;
}

/** 台帳に無い録画 dir を走査して回収する。 返値は回収した本数。 hydrate 完了後に呼ぶこと。 */
export async function recoverOrphanRecordings(): Promise<number> {
  const doc = FileSystem.documentDirectory;
  if (!doc) return 0;
  const recRoot = `${doc}recordings/`;
  let names: string[];
  try {
    names = await FileSystem.readDirectoryAsync(recRoot);
  } catch {
    return 0; // recordings/ 未作成 (= まだ一度も録画していない)
  }
  const known = new Set<string>();
  for (const c of Object.values(dataflowStore.getState().clips)) {
    const rel = docRelative(c.sessionDir);
    if (rel) known.add(rel);
  }
  let recovered = 0;
  for (const name of names) {
    if (!name.startsWith('rec-')) continue;
    if (known.has(`recordings/${name}`)) continue;
    const dir = `${recRoot}${name}/`;
    const mp4 = await FileSystem.getInfoAsync(`${dir}rgb.mp4`, { size: true });
    if (!mp4.exists || mp4.isDirectory || (mp4.size ?? 0) < MIN_RECOVERABLE_MP4_BYTES) {
      await FileSystem.deleteAsync(dir, { idempotent: true }).catch(() => {});
      continue;
    }
    // 撮影構成と機種は metadata.json (= 初回 frame で書かれる) から復元。 録画尺は不明のまま
    // (= 申告値が無いだけで、 実尺はサーバが mp4 から測れる)。
    let configId = 'arkit';
    let deviceModel: string | null = null;
    try {
      const meta = JSON.parse(await FileSystem.readAsStringAsync(`${dir}metadata.json`));
      if (typeof meta.recording_config === 'string') configId = meta.recording_config;
      if (typeof meta.device_model === 'string') deviceModel = meta.device_model;
    } catch {
      // metadata 無しでも mp4 があれば回収する (= 既定の arkit として扱う)
    }
    const config = getRecordingConfig(configId);
    if (!config) continue;
    const workDir = `${dir}sign/`;
    await FileSystem.makeDirectoryAsync(workDir, { intermediates: true }).catch(() => {});
    dataflowStore.getState().upsertClip({
      id: makeLocalClipId(),
      state: 'recorded',
      createdAt: mp4.modificationTime ? Math.round(mp4.modificationTime * 1000) : Date.now(),
      recordingConfigId: config.id,
      durationMs: null,
      deviceModel,
      sessionDir: dir,
      stage: 'unsigned',
      workDir,
    });
    recovered += 1;
  }
  return recovered;
}

/**
 * クリップの現在 stage から実際に再開できる stage を返す (= 中間成果物の欠落をチェックして降格)。
 * 'signed' でも署名済 rgb.mp4 が消えていれば 'unsigned' に降格して再署名する。
 */
async function effectiveStage(stage: Pipeline1Stage, workDir: string | undefined): Promise<Pipeline1Stage> {
  if (stage === 'registered') return 'registered';
  if (stage === 'signed') {
    if (workDir && (await exists(signedUriIn(workDir)))) return 'signed';
  }
  return 'unsigned';
}

/**
 * クリップを現在 stage から前進させる (= submit / retry 共通)。
 *
 *   unsigned → signRecording → 'signed' (= signature_hash 誕生、 local id → hash に re-key)
 *   signed   → upload + register → 'registered' (= state='uploaded')
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
  dataflowStore.getState().patchClip(clipId, { state: 'uploading', errorMessage: null, uploadProgress: 0 });

  const targetIdRef = { id: clipId };
  const progressSink: EventSink = (e: DataflowEventInput) => {
    sink(e);
    const p = stepProgress(e.step);
    if (p != null && e.level !== 'error') {
      dataflowStore.getState().patchClip(targetIdRef.id, { uploadProgress: p });
    }
  };

  try {
    let stage = await effectiveStage(initial.stage ?? 'unsigned', workDir);

    // ─── 未署名 → 署名済み (D1 → signature_hash 誕生) ──────────────────
    if (stage === 'unsigned') {
      const rawMp4Uri = config.primaryVideoUri(session);
      const signed = await signRecording(rawMp4Uri, workDir, progressSink);
      // identity 誕生: local id → 新 signature_hash に re-key。
      dataflowStore.getState().renameClipId(clipId, signed.signatureHash);
      clipId = signed.signatureHash;
      targetIdRef.id = clipId;
      dataflowStore.getState().patchClip(clipId, {
        stage: 'signed',
        signatureHash: signed.signatureHash,
        contentSize: signed.contentSize,
        uploadProgress: 0.4,
      });
      stage = 'signed';
    }

    // ─── 署名済み → 登録済み (R2 + POST /api/clips) ───────────────────
    if (stage === 'signed') {
      const cur = dataflowStore.getState().clips[clipId];
      if (!cur?.signatureHash) throw new Error('signature_hash 未確定で登録段に進めません');

      // 撮影構成が出力したファイル群を R2 に並列 PUT。
      // 主な動画 (= isPrimaryVideo true) は workDir の D1 署名済を使う。
      // それ以外 (realtime_handpose.jsonl / metadata.json / imu.jsonl 等) は sessionDir からそのまま。
      const files: Record<string, string> = {};
      for (const spec of config.outputFiles) {
        if (spec.isPrimaryVideo) {
          files[spec.name] = signedUriIn(workDir);
          continue;
        }
        const localUri = `${session.sessionDir}${spec.name}`;
        const info = await FileSystem.getInfoAsync(localUri);
        if (info.exists) {
          files[spec.name] = localUri;
        } else if (spec.required) {
          throw new Error(`required output file missing: ${spec.name}`);
        }
      }
      await uploadToR2(
        { signatureHash: cur.signatureHash, recordingConfig: config.id, files },
        progressSink,
        (f) => {
          dataflowStore.getState().patchClip(targetIdRef.id, { uploadProgress: uploadFractionToProgress(f) });
        },
      );

      await registerClip(
        {
          signatureHash: cur.signatureHash,
          contentSize: cur.contentSize ?? 0,
          accountPubkey: getAccountPubkey(),
          recordingConfig: config.id,
          durationMs: cur.durationMs ?? null,
          deviceModel: cur.deviceModel ?? null,
        },
        progressSink,
      );

      dataflowStore.getState().patchClip(clipId, {
        stage: 'registered',
        state: 'uploaded',
        uploadProgress: 1,
      });
      // アップロード完了。 durable な clip dir を片付ける (サムネは以後サーバの動画から都度起こす)。
      await cleanupTmpDir(session.sessionDir);
      return;
    }

    // ─── 登録済み: 端末側 Pipeline 1 は完了。
  } catch (e) {
    dataflowStore.getState().patchClip(clipId, { state: 'error', errorMessage: errMsg(e) });
  }
}

/**
 * クリップを破棄する (= ローカル削除)。 durable な clip dir も掃除して Documents にゴミを残さない。
 */
export async function discardClip(clipId: string): Promise<void> {
  const clip = dataflowStore.getState().clips[clipId];
  if (clip?.sessionDir) await cleanupTmpDir(clip.sessionDir);
  dataflowStore.getState().removeClip(clipId);
}

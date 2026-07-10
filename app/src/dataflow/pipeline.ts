// Pipeline 1 の段レジューム型ランナー (= 「送る」 と 「もう一度試す」 を統一する単一の前進関数)。
//
// v0.1.4 (task 12 適用後): 段は以下の 3 つ:
//
//   pending    → 生 MP4 の SHA-256 計算  → 'hashed'   (= content_hash 誕生、 local id → hash に re-key)
//   hashed     → upload + POST /api/clips → 'registered' (= state='uploaded')
//   registered → (端末側はここまで)
//
// 冪等性: 'hashed' 以降は同じ content_hash を使い回す。 サーバ側の重複排除
// (= (account, content_hash)) が効いて二重 clip 行を防ぐ。
//
// ⚠ Layer 1 (dataflow)。react / react-native を import しない。

import * as FileSystem from 'expo-file-system';

import type { EventSink, DataflowEventInput } from './events';
import { getRecordingConfig, type RecordingConfig, type RecordingSession } from './recording-configs';
import type { Pipeline1Stage } from './types';
import { computeContentHash } from './steps/hash';
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

/** clip dir 配下のゴミを掃除する (アップロード完了 or 破棄時)。 */
async function cleanupClipDir(dir: string): Promise<void> {
  try {
    await FileSystem.deleteAsync(dir, { idempotent: true });
  } catch {
    // 失敗は致命ではない
  }
}

/** Pipeline 1 の step 名 → uploadProgress (0..1) の段階写像。
 *  content-hash 区間 (0→0.35) と r2-upload 区間 (0.4→0.97) はここでは固定値にせず (= null)、
 *  それぞれの onProgress の実進捗で滑らかに埋める (数 GB のハッシュ計算が数十分無言にならないように)。 */
function stepProgress(step: string): number | null {
  switch (step) {
    case 'register-clip': return 1.0;
    default:              return null;
  }
}

/** ハッシュ計算の実バイト進捗 (0..1) を uploadProgress の 0→0.35 区間に写す。 */
function hashFractionToProgress(f: number): number {
  return Math.max(0, Math.min(1, f)) * 0.35;
}

/** アップロードの実バイト進捗 (0..1) を uploadProgress の 0.4→0.97 区間に写す。 */
function uploadFractionToProgress(f: number): number {
  return 0.4 + Math.max(0, Math.min(1, f)) * 0.57;
}

/**
 * 撮影完了時にクリップを起こす (= state 'recorded' + stage 'pending' で local id 採番)。
 * v0.1.4: ここでは自動アップロードしない。 ユーザーが一覧 (マイビデオ) でプレビューを確認し
 * 「アップロード」 を押した時に advanceClip が hash → R2 → 登録 を進める。
 */
export async function enqueueRecording(input: {
  config: RecordingConfig;
  session: RecordingSession;
  /** 撮影ファクト (= UI 層で計測)。 録画尺 (ms、 stop−start) と端末機種。 */
  durationMs?: number | null;
  deviceModel?: string | null;
}): Promise<string> {
  const localId = makeLocalClipId();
  const store = dataflowStore.getState();
  store.upsertClip({
    id: localId,
    state: 'recorded',
    createdAt: Date.now(),
    recordingConfigId: input.config.id,
    durationMs: input.durationMs ?? null,
    deviceModel: input.deviceModel ?? null,
    sessionDir: input.session.sessionDir,
    stage: 'pending',
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
    dataflowStore.getState().upsertClip({
      id: makeLocalClipId(),
      state: 'recorded',
      createdAt: mp4.modificationTime ? Math.round(mp4.modificationTime * 1000) : Date.now(),
      recordingConfigId: config.id,
      durationMs: null,
      deviceModel,
      sessionDir: dir,
      stage: 'pending',
    });
    recovered += 1;
  }
  return recovered;
}

/**
 * クリップの現在 stage から実際に再開できる stage を返す。
 * content_hash が store から消えていれば 'pending' に降格して再計算する。
 */
function effectiveStage(stage: Pipeline1Stage, contentHash: string | undefined): Pipeline1Stage {
  if (stage === 'registered') return 'registered';
  if (stage === 'hashed' && contentHash) return 'hashed';
  return 'pending';
}

/**
 * クリップを現在 stage から前進させる (= submit / retry 共通)。
 *
 *   pending → computeContentHash → 'hashed' (= content_hash 誕生、 local id → hash に re-key)
 *   hashed  → upload + register  → 'registered' (= state='uploaded')
 */
export async function advanceClip(clipId: string, sink: EventSink): Promise<void> {
  const initial = dataflowStore.getState().clips[clipId];
  if (!initial) return;

  const config = initial.recordingConfigId ? getRecordingConfig(initial.recordingConfigId) : undefined;
  if (!config || !initial.sessionDir) {
    dataflowStore.getState().patchClip(clipId, {
      state: 'error',
      errorMessage: 'クリップのメタ情報 (撮影構成 / session) が不足し再開できません',
    });
    return;
  }
  const session: RecordingSession = { sessionDir: initial.sessionDir };

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
    let stage = effectiveStage(initial.stage ?? 'pending', initial.contentHash);

    // ─── pending → hashed (content_hash 誕生) ─────────────────────────
    if (stage === 'pending') {
      const rawMp4Uri = config.primaryVideoUri(session);
      const hashed = await computeContentHash(rawMp4Uri, progressSink, (f) => {
        dataflowStore.getState().patchClip(targetIdRef.id, { uploadProgress: hashFractionToProgress(f) });
      });
      dataflowStore.getState().renameClipId(clipId, hashed.contentHash);
      clipId = hashed.contentHash;
      targetIdRef.id = clipId;
      dataflowStore.getState().patchClip(clipId, {
        stage: 'hashed',
        contentHash: hashed.contentHash,
        contentSize: hashed.contentSize,
        uploadProgress: 0.4,
      });
      stage = 'hashed';
    }

    // ─── hashed → registered (R2 + POST /api/clips) ───────────────────
    if (stage === 'hashed') {
      const cur = dataflowStore.getState().clips[clipId];
      if (!cur?.contentHash) throw new Error('content_hash 未確定で登録段に進めません');

      // 撮影構成が出力したファイル群を R2 に並列 PUT。 v0.1.4 (task 12 適用後) は署名を挟まないので、
      // 主な動画も session dir の生 mp4 をそのまま送る。
      const files: Record<string, string> = {};
      for (const spec of config.outputFiles) {
        const localUri = `${session.sessionDir}${spec.name}`;
        const info = await FileSystem.getInfoAsync(localUri);
        if (info.exists) {
          files[spec.name] = localUri;
        } else if (spec.required) {
          throw new Error(`required output file missing: ${spec.name}`);
        }
      }
      await uploadToR2(
        { contentHash: cur.contentHash, recordingConfig: config.id, files },
        progressSink,
        (f) => {
          dataflowStore.getState().patchClip(targetIdRef.id, { uploadProgress: uploadFractionToProgress(f) });
        },
      );

      await registerClip(
        {
          contentHash: cur.contentHash,
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
      await cleanupClipDir(session.sessionDir);
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
  if (clip?.sessionDir) await cleanupClipDir(clip.sessionDir);
  dataflowStore.getState().removeClip(clipId);
}

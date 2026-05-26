import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { getCurrentSession, requireCurrentSession } from './auth';
import { runPipeline1, type Pipeline1Step } from './pipeline1';
import { MERKLE_COLLECTION, MERKLE_TREE, SERVER_URL } from '../env';

// クリップの状態機械とパイプラインの抽象。
//
// SPECS_JA §2.7 のクリップ状態機械を そのまま型として表現する。
// rootlens-server (= EXPO_PUBLIC_SERVER_URL 必須) に対して 4 ファイル並列 PUT →
// finalize → polling の流れで状態を hydrate する。
//
// 永続化: 進行中 / 準備完了 のクリップは AsyncStorage に保存する
// (= アプリ再起動後も Collection に表示される)。 ステーキング済みのクリップは
// オンチェーン (DAS) から hydrate するため、 ここでは保存しない。

export type ClipState =
  | 'uploading'
  | 'processing'
  | 'ready'
  | 'staked'
  | 'error';

/// サーバ shared/api-types.ts の ProcessingStep と完全一致させる (v0.1.3 = 4-layer scoring)。
export type ProcessingStep =
  | 'metadata-scan'    // Layer 1: メタデータ解析
  | 'frame-sampling'   // Layer 2: フレームサンプリング画像解析
  | 'vlm-score'        // Layer 3: VLM Claude Haiku 4.5 セマンティック採点
  | 'gtsam-eval';      // Layer 4: GTSAM Video-IMU 整合性検証

export interface QualityBreakdown {
  /// いずれかの手が出ているフレーム比率 (0..1)。 Pipeline 2 では未計算で null、
  /// Pipeline 3 (= WiLoR) 通過後に backfill。
  anyHandRatio: number | null;
  /// 両手が出ているフレーム比率 (0..1)。 同上、 Pipeline 3 で backfill。
  twoHandRatio: number | null;
  /// 深度データが有効なフレーム比率 (0..1)。 LiDAR 非搭載機は null。
  depthValidRatio: number | null;
  /// RGB / 深度 / IMU の同期率 (0..1)
  syncRatio: number;
  /// フレーム欠落数
  frameGapCount: number;
}

export interface ClipReward {
  /// USDC 単位の想定報酬レンジ (low, high)
  rangeUsdcLow: number;
  rangeUsdcHigh: number;
}

export interface Clip {
  /// 内部ローカル ID。 Root NFT 発行後は rootAssetId が埋まる。
  id: string;
  /// タスクの ID (= taskCatalog 参照)
  taskId: string;
  /// 現在の状態
  state: ClipState;
  /// 端末で「送る」 を押した時刻 (ms epoch)
  createdAt: number;

  /// アップロード進捗 (0..1)。 state === 'uploading' のみで意味を持つ。
  uploadProgress?: number;
  /// 処理中のステップ。 state === 'processing' のみで意味を持つ。
  processingStep?: ProcessingStep;

  /// VLM 終了時の達成確度 (0..100)。 端末側で取得して送信した値。
  achievementConfidence?: number;
  /// サーバ側 品質スコア (0..100)。 state >= 'ready' で意味を持つ。
  qualityScore?: number;
  /// 品質スコアの内訳。
  qualityBreakdown?: QualityBreakdown;
  /// 想定報酬レンジ。
  reward?: ClipReward;
  /// プレビュー用のフレーム画像 URI (端末ファイル / または http)。
  /// state < 'ready' では撮影時の snapshot、 'ready' 以降では server がぼかし済 MP4 を提供する
  /// ので previewVideoUrl 側を優先する (= 画像は fallback)。
  previewUris?: string[];
  /// サーバが生成した ぼかし済 preview MP4 の 事前署名 GET URL。 ready 状態以降で値が入る。
  previewVideoUrl?: string;

  /// Root NFT cNFT asset ID。 state >= 'ready' で意味を持つ。
  rootAssetId?: string;
  /// 現在の delegate (= owner と異なれば staked)。
  delegate?: string | null;

  /// ライセンス販売の集計 (= state === 'staked' の場合)。
  licenseCount?: number;
  revenueUsdc?: number;

  /// state === 'error' のとき、 サーバから返ったエラー内容 (= UX に表示)。
  errorMessage?: string;
}

interface EnqueueInput {
  taskId: string;
  /// 端末 startArkitRecording が返したセッションディレクトリの file:// URI。
  /// 配下に rgb.mp4 + sensors.jsonl + imu_high_rate.jsonl + camera_intrinsics.json が並ぶ。
  sessionDirUri: string;
  achievementConfidence: number;
  /// 端末で撮ったプレビュー用 snapshot URI (= サーバ完了時に server 側 ぼかし済 MP4 url で置き換わる)
  snapshotUri?: string;
}

/// rootlens-server の base URL。 src/env.ts から取得 (default は本番)。
export function getServerBaseUrl(): string {
  return SERVER_URL;
}

// ─── store 実装 ─────────────────────────────────────────────────────────

const STORAGE_KEY = '@rootlens/clips/v1';

type Listener = () => void;

class ClipStore {
  private clips: Map<string, Clip> = new Map();
  private listeners: Set<Listener> = new Set();
  private hydrated = false;

  /// useSyncExternalStore は getSnapshot が安定参照を返すことを要求する。
  /// データ変更があるまで同じ配列インスタンスを返すよう cache する。
  private cachedList: Clip[] | null = null;

  /// 起動時に AsyncStorage から hydrate。 React 側 hook が初回 mount 時に呼ぶ。
  async hydrate(): Promise<void> {
    if (this.hydrated) return;
    this.hydrated = true;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const arr: Clip[] = JSON.parse(raw);
        for (const c of arr) {
          // 永続化されていた uploading / processing は、 アプリ kill 時にタイマー切れ
          // なので失敗扱いにする (= 本物 server だったら再 query するところ)
          if (c.state === 'uploading' || c.state === 'processing') {
            c.state = 'error';
            c.errorMessage = 'アプリ再起動中に中断されました';
          }
          this.clips.set(c.id, c);
        }
      }
    } catch (e) {
      console.error('[clipPipeline] hydrate failed (persisted clips ignored):', e);
    }
    this.notify();
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => { this.listeners.delete(l); };
  }

  list(): Clip[] {
    // 新しい順。 cache を使い回し、 データ変更時のみ再算出 (= notify で invalidate)。
    if (this.cachedList === null) {
      this.cachedList = Array.from(this.clips.values()).sort((a, b) => b.createdAt - a.createdAt);
    }
    return this.cachedList;
  }

  get(id: string): Clip | undefined {
    return this.clips.get(id);
  }

  /// 「送る」 で呼ばれる。 サーバへ 4 ファイル PUT → finalize → polling で
  /// uploading → processing → ready を駆動する。 失敗時は state='error' + errorMessage。
  enqueue(input: EnqueueInput): string {
    const id = makeClipId();
    const clip: Clip = {
      id,
      taskId: input.taskId,
      state: 'uploading',
      createdAt: Date.now(),
      uploadProgress: 0,
      achievementConfidence: input.achievementConfidence,
      previewUris: input.snapshotUri ? [input.snapshotUri] : undefined,
    };
    this.clips.set(id, clip);
    this.notify();
    this.persist();

    this.httpEnqueue(id, input).catch((e) => {
      console.warn('[clipPipeline] httpEnqueue failed', e);
      this.update(id, { state: 'error', errorMessage: errorMessageOf(e) });
    });
    return id;
  }

  /// ステーキング。 POST /api/clips/:id/stake を呼んで state を 'staked' に遷移させる。
  async stake(id: string): Promise<void> {
    const clip = this.clips.get(id);
    if (!clip || clip.state !== 'ready') {
      throw new Error(`Cannot stake from state '${clip?.state ?? 'missing'}'`);
    }
    await this.httpStake(id);
  }

  /// クリップ削除 (= 不合格 / 処理エラー / 準備完了 状態のクリップを撮影者の意思で消す)
  remove(id: string): void {
    this.stopHttpPolling(id);
    this.clips.delete(id);
    this.notify();
    this.persist();
  }

  /// 処理エラーから撮影者が「もう一度試す」 場合の再投入。 サーバ側で
  /// state を 'processing' に戻し workflow を再起動する。 R2 raw データはそのまま使う。
  async retry(id: string): Promise<void> {
    const clip = this.clips.get(id);
    if (!clip || clip.state !== 'error') {
      throw new Error(`Cannot retry from state '${clip?.state ?? 'missing'}'`);
    }
    await this.httpRetry(id);
  }

  // ─── HTTP backend (= 本物の rootlens-server を叩く) ──────────────────

  private httpPollers: Map<string, ReturnType<typeof setInterval>> = new Map();

  // UI に出す uploadProgress を Pipeline 1 step 名から段階的に進める。
  // (true な progress bar ではなく、 段階表示。 失敗時は最後の地点で止まる。)

  /// v0.1.3 全 7 ステップ Pipeline 1 を device で完走させ、 サーバに登録 → finalize → polling。
  /// mock-device と同一フロー。 詳細は src/services/pipeline1.ts。
  private async httpEnqueue(localId: string, input: EnqueueInput): Promise<void> {
    const sessionDir = input.sessionDirUri.endsWith('/')
      ? input.sessionDirUri
      : `${input.sessionDirUri}/`;

    // Step 1-8 (= C2PA D1+D2 + blur + content_id + R2 upload + TP + cNFT + POST /api/clips)
    const p1 = await runPipeline1(
      {
        taskId: input.taskId,
        rawMp4Uri: `${sessionDir}rgb.mp4`,
        sensorsUri: `${sessionDir}sensors.jsonl`,
        imuUri: `${sessionDir}imu_high_rate.jsonl`,
        intrinsicsUri: `${sessionDir}camera_intrinsics.json`,
        achievementConfidence: input.achievementConfidence,
        merkleTree: MERKLE_TREE,
        collection: MERKLE_COLLECTION,
      },
      (p) => {
        this.update(localId, { uploadProgress: pipelineStepProgress(p.step) });
      },
    );

    // local id を サーバ発番 id に rewrite。
    this.renameLocalId(localId, p1.clipId);
    this.update(p1.clipId, { id: p1.clipId, uploadProgress: 1 });

    const serverUrl = getServerBaseUrl();
    const walletPubkey = p1.walletPubkey;

    // Step 9: POST /api/clips/:id/finalize → サーバ workflow 起動
    const finRes = await fetch(`${serverUrl}/api/clips/${p1.clipId}/finalize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Wallet-Pubkey': walletPubkey,
      },
      body: JSON.stringify({ contentId: p1.contentId }),
    });
    if (!finRes.ok) {
      throw new Error(
        `POST /api/clips/${p1.clipId}/finalize ${finRes.status}: ${await finRes.text().catch(() => '')}`,
      );
    }
    const { clip: finalized } = await finRes.json();
    this.applyServerClip(finalized);

    // Step 10: polling 開始 (= 2 秒間隔、 terminal state で停止)
    this.startHttpPolling(p1.clipId);
  }

  private async httpStake(clipId: string): Promise<void> {
    const serverUrl = getServerBaseUrl();
    const walletPubkey = requireCurrentSession().pubkey.toBase58();

    const res = await fetch(`${serverUrl}/api/clips/${clipId}/stake`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Wallet-Pubkey': walletPubkey,
      },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`POST /api/clips/${clipId}/stake failed: ${res.status} ${body.slice(0, 200)}`);
    }
    const { clip: staked } = await res.json();
    this.applyServerClip(staked);
  }

  /// 'error' クリップを再投入。 サーバ側で state を 'processing' に戻し workflow を再起動する。
  private async httpRetry(clipId: string): Promise<void> {
    const serverUrl = getServerBaseUrl();
    const walletPubkey = requireCurrentSession().pubkey.toBase58();

    const res = await fetch(`${serverUrl}/api/clips/${clipId}/retry`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Wallet-Pubkey': walletPubkey,
      },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`POST /api/clips/${clipId}/retry failed: ${res.status} ${body.slice(0, 200)}`);
    }
    const { clip: retried } = await res.json();
    this.applyServerClip(retried);
    this.startHttpPolling(clipId);
  }

  /// polling 1 件あたりの連続失敗回数。 閾値を超えたら state を error にして撮影者に通知する。
  private pollFailureCount: Map<string, number> = new Map();
  private static readonly POLL_FAILURE_THRESHOLD = 5;

  private startHttpPolling(clipId: string): void {
    if (this.httpPollers.has(clipId)) return;
    const session = getCurrentSession();
    if (!session) return;
    const serverUrl = getServerBaseUrl();
    const walletPubkey = session.pubkey.toBase58();

    const tick = async () => {
      try {
        const res = await fetch(`${serverUrl}/api/clips/${clipId}`, {
          headers: { 'X-Wallet-Pubkey': walletPubkey },
        });
        if (!res.ok) {
          throw new Error(`GET /api/clips/${clipId} failed: ${res.status}`);
        }
        const { clip } = await res.json();
        this.pollFailureCount.delete(clipId);
        this.applyServerClip(clip);
        if (clip.state === 'ready' || clip.state === 'error' || clip.state === 'staked') {
          this.stopHttpPolling(clipId);
        }
      } catch (e) {
        const next = (this.pollFailureCount.get(clipId) ?? 0) + 1;
        this.pollFailureCount.set(clipId, next);
        const real = errorMessageOf(e);
        console.warn(`[clipPipeline] poll tick failed (${next}/${ClipStore.POLL_FAILURE_THRESHOLD}):`, real);
        if (next >= ClipStore.POLL_FAILURE_THRESHOLD) {
          this.stopHttpPolling(clipId);
          this.update(clipId, {
            state: 'error',
            // 「試行回数超過」 は client 側の都合で隠語的。 ユーザ的にも開発的にも、
            // 実エラー (= server がどう拒否したか) をそのまま見せる方が嘘がなくて良い。
            errorMessage: `poll (${ClipStore.POLL_FAILURE_THRESHOLD}回連続失敗): ${real}`,
          });
        }
      }
    };
    tick();  // 即時 1 回
    this.httpPollers.set(clipId, setInterval(tick, 2_000));
  }

  private stopHttpPolling(clipId: string): void {
    const t = this.httpPollers.get(clipId);
    if (t) {
      clearInterval(t);
      this.httpPollers.delete(clipId);
    }
    this.pollFailureCount.delete(clipId);
  }

  /// サーバ DTO を ローカル Clip 型に正規化して update。
  private applyServerClip(serverClip: any): void {
    const id = serverClip.id;
    const cur = this.clips.get(id);
    const merged: Clip = {
      id,
      taskId: serverClip.taskId,
      state: serverClip.state,
      createdAt: cur?.createdAt ?? new Date(serverClip.createdAt).getTime(),
      achievementConfidence: serverClip.achievementConfidence ?? undefined,
      processingStep: serverClip.processingStep ?? undefined,
      qualityScore: serverClip.qualityScore ?? undefined,
      qualityBreakdown: serverClip.qualityBreakdown ?? undefined,
      reward: cur?.reward,
      previewUris: cur?.previewUris,
      rootAssetId: serverClip.rootAssetId ?? undefined,
      delegate: serverClip.delegate ?? null,
      licenseCount: serverClip.licenseCount ?? 0,
      revenueUsdc: serverClip.revenueUsdc ?? 0,
      previewVideoUrl: serverClip.previewVideoUrl ?? undefined,
      errorMessage: serverClip.errorMessage ?? undefined,
      // uploadProgress は client 側でしか分からないので current 値を保持
      uploadProgress: cur?.uploadProgress,
    };
    this.clips.set(id, merged);
    this.notify();
    this.persist();
  }

  /// 端末発番 local id → サーバ発番 id への置き換え (= 既存 store の同一 entry に置き直す)。
  private renameLocalId(localId: string, serverId: string): void {
    if (localId === serverId) return;
    const cur = this.clips.get(localId);
    if (!cur) return;
    this.clips.delete(localId);
    this.clips.set(serverId, { ...cur, id: serverId });
    this.notify();
    this.persist();
  }

  // ─── 内部 ─────────────────────────────────────────────────────────

  private update(id: string, patch: Partial<Clip>): void {
    const cur = this.clips.get(id);
    if (!cur) return;
    this.clips.set(id, { ...cur, ...patch });
    this.notify();
    this.persist();
  }

  private notify(): void {
    // データが変わったので cache を invalidate (= 次の list() で再算出される)
    this.cachedList = null;
    for (const l of this.listeners) l();
  }

  private async persist(): Promise<void> {
    try {
      const arr = Array.from(this.clips.values()).filter((c) => c.state !== 'staked');
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
    } catch {
      // ignore
    }
  }

}

// ─── ヘルパー ─────────────────────────────────────────────────────────

function makeClipId(): string {
  return `clip_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/// Pipeline 1 ステップ名 → UI 上の uploadProgress (= 0..1) 写像。
/// 厳密な byte 進捗ではなく段階を見せるだけ。
function pipelineStepProgress(step: Pipeline1Step): number {
  switch (step) {
    case 'sign-d1': return 0.1;
    case 'blur': return 0.25;
    case 'sign-d2': return 0.4;
    case 'content-id': return 0.45;
    case 'r2-upload': return 0.65;
    case 'tp-process': return 0.8;
    case 'cnft-mint': return 0.92;
    case 'register-clip': return 1.0;
  }
}

/// 例外 / 文字列 / 任意値 を UI 向けの 1 行 message に正規化。
function errorMessageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try { return JSON.stringify(e); } catch { return String(e); }
}

// ─── singleton + React hooks ───────────────────────────────────────────

export const clipStore = new ClipStore();

/// 全クリップを購読する。 アプリ起動時に hydrate を 1 度起動。
export function useClips(): Clip[] {
  useEffect(() => {
    // mount 時に 1 度だけ hydrate (=多重呼び出しは内部で no-op)
    clipStore.hydrate();
  }, []);
  const subscribe = useCallback((cb: () => void) => clipStore.subscribe(cb), []);
  const getSnapshot = useCallback(() => clipStore.list(), []);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/// 単一クリップを購読する。
export function useClip(id: string | null | undefined): Clip | null {
  const subscribe = useCallback((cb: () => void) => clipStore.subscribe(cb), []);
  const getSnapshot = useCallback(() => (id ? clipStore.get(id) ?? null : null), [id]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// ─── ラベル翻訳 ──────────────────────────────────────────────────────────

export function describeState(s: ClipState): string {
  switch (s) {
    case 'uploading':  return 'アップロード中';
    case 'processing': return '処理中';
    case 'ready':      return '準備完了';
    case 'staked':     return 'ステーキング済み';
    case 'error':      return '処理エラー';
  }
}

export function describeProcessingStep(step: ProcessingStep | undefined): string {
  switch (step) {
    case 'metadata-scan':   return 'メタデータ解析中';
    case 'frame-sampling':  return 'フレームサンプル解析中';
    case 'vlm-score':       return 'VLM セマンティック採点中';
    case 'gtsam-eval':      return 'Video-IMU 整合性検証中';
    default:                return '';
  }
}

export function processingStepIndex(step: ProcessingStep | undefined): number {
  switch (step) {
    case 'metadata-scan':   return 1;
    case 'frame-sampling':  return 2;
    case 'vlm-score':       return 3;
    case 'gtsam-eval':      return 4;
    default:                return 0;
  }
}

export const PROCESSING_TOTAL_STEPS = 4;

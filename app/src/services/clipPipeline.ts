import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { getDemoWalletPubkey } from '../domain/wallet';

// クリップの状態機械とパイプラインの抽象。
//
// SPECS_JA §2.7 のクリップ状態機械を そのまま型として表現する。
//
// バックエンドは 2 つの実装を持つ:
//   - MockBackend (= 時間経過で状態遷移するモック、 開発初期 / E2E テスト用)
//   - HttpBackend (= 本物の rootlens-server を叩く、 production)
// 環境変数 EXPO_PUBLIC_USE_REAL_SERVER === 'true' かつ EXPO_PUBLIC_SERVER_URL があれば
// HttpBackend を使う。 そうでなければ MockBackend。
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

export type ProcessingStep =
  | 'c2pa-verify'
  | 'anonymize'
  | 'derive-manifest'
  | 'quality-eval'
  | 'tp-submit'
  | 'r2-place';

export interface QualityBreakdown {
  /// いずれかの手が出ているフレーム比率 (0..1)
  anyHandRatio: number;
  /// 両手が出ているフレーム比率 (0..1)
  twoHandRatio: number;
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

// ─── backend selection (= mock / http の切り替え口) ────────────────────

/// 環境変数で active backend を選ぶ。
/// production では EXPO_PUBLIC_USE_REAL_SERVER=true + EXPO_PUBLIC_SERVER_URL を set。
/// それ以外 (= 開発初期) は mock。
function selectBackend(): 'mock' | 'http' {
  const ENV = process.env as Record<string, string | undefined>;
  if (ENV.EXPO_PUBLIC_USE_REAL_SERVER === 'true' && ENV.EXPO_PUBLIC_SERVER_URL) {
    return 'http';
  }
  return 'mock';
}

/// rootlens-server の base URL (= http backend 使用時のみ意味を持つ)。
export function getServerBaseUrl(): string | null {
  return process.env.EXPO_PUBLIC_SERVER_URL ?? null;
}

/// 現在の active backend モードを返す (= UI で「dev mock 動作中」 を表示したい時等に使う)。
export function getActiveBackendMode(): 'mock' | 'http' {
  return selectBackend();
}

// ─── store 実装 ─────────────────────────────────────────────────────────

const STORAGE_KEY = '@rootlens/clips/v1';

type Listener = () => void;

class ClipStore {
  private clips: Map<string, Clip> = new Map();
  private listeners: Set<Listener> = new Set();
  private hydrated = false;
  private pipelineTimers: Map<string, ReturnType<typeof setTimeout>[]> = new Map();

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
          }
          this.clips.set(c.id, c);
        }
      }
    } catch {
      // 破損データは諦める
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

  /// 「送る」 で呼ばれる。 アップロード → 処理 → 準備完了 を駆動する。
  /// active backend = 'http' なら本物の rootlens-server、 'mock' なら時間経過 simulation。
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

    if (selectBackend() === 'http') {
      this.httpEnqueue(id, input).catch((e) => {
        console.warn('[clipPipeline] httpEnqueue failed', e);
        this.update(id, { state: 'error' });
      });
    } else {
      this.simulatePipeline(id, input.sessionDirUri);
    }
    return id;
  }

  /// ステーキング。 http backend では POST /api/clips/:id/stake、 mock では即時遷移。
  async stake(id: string): Promise<void> {
    const clip = this.clips.get(id);
    if (!clip || clip.state !== 'ready') return;

    if (selectBackend() === 'http') {
      await this.httpStake(id);
      return;
    }
    // mock: 800ms wait してから state 遷移
    await new Promise((r) => setTimeout(r, 800));
    this.update(id, { state: 'staked', delegate: 'rootlens-cosign-authority' });
  }

  /// クリップ削除 (= 不合格 / 処理エラー / 準備完了 状態のクリップを撮影者の意思で消す)
  remove(id: string): void {
    this.cancelTimers(id);
    this.clips.delete(id);
    this.notify();
    this.persist();
  }

  /// 処理エラーから撮影者が「もう一度試す」 場合の再投入 (= 本実装ではサーバへ
  /// 再処理リクエストを送る、 fake では新しいクリップとして simulate しなおす)
  retry(id: string): void {
    const clip = this.clips.get(id);
    if (!clip) return;
    if (clip.state !== 'error') return;
    this.update(id, {
      state: 'uploading',
      uploadProgress: 0,
      qualityScore: undefined,
      qualityBreakdown: undefined,
    });
    this.simulatePipeline(id, '');
  }

  // ─── HTTP backend (= 本物の rootlens-server を叩く) ──────────────────

  private httpPollers: Map<string, ReturnType<typeof setInterval>> = new Map();

  private async httpEnqueue(localId: string, input: EnqueueInput): Promise<void> {
    const serverUrl = getServerBaseUrl();
    if (!serverUrl) throw new Error('EXPO_PUBLIC_SERVER_URL not set');
    const walletPubkey = getDemoWalletPubkey()?.toBase58();
    if (!walletPubkey) throw new Error('No wallet pubkey available');

    // 1. sessionDir 配下の 4 ファイルの存在確認 + rgb.mp4 のサイズ + hash
    const sessionDir = input.sessionDirUri.endsWith('/') ? input.sessionDirUri : `${input.sessionDirUri}/`;
    const mp4Uri = `${sessionDir}rgb.mp4`;
    const sensorsUri = `${sessionDir}sensors.jsonl`;
    const imuUri = `${sessionDir}imu_high_rate.jsonl`;
    const intrinsicsUri = `${sessionDir}camera_intrinsics.json`;
    const info = await FileSystem.getInfoAsync(mp4Uri, { size: true });
    if (!info.exists) throw new Error(`rgb.mp4 not found in session dir: ${sessionDir}`);
    const contentSize = (info as any).size ?? 0;
    const seed = `${mp4Uri}|${contentSize}|${Date.now()}`;
    const contentHash = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      seed,
      { encoding: Crypto.CryptoEncoding.HEX },
    );

    // 2. POST /api/clips → 4 ファイル分の presigned PUT URL を取得
    const createRes = await fetch(`${serverUrl}/api/clips`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Wallet-Pubkey': walletPubkey,
      },
      body: JSON.stringify({
        taskId: input.taskId,
        achievementConfidence: input.achievementConfidence,
        contentHash,
        contentSize,
      }),
    });
    if (!createRes.ok) throw new Error(`POST /api/clips failed: ${createRes.status}`);
    const { clip: serverClip, upload } = await createRes.json();

    // local id (= UI 表示用) を サーバ発番 id に rewrite。 同時に既存 listener の購読を維持。
    this.renameLocalId(localId, serverClip.id);
    this.update(serverClip.id, { id: serverClip.id });

    // 3. R2 へ 4 ファイルを並列 PUT (= rgb.mp4 + sensors.jsonl + imu_high_rate.jsonl + camera_intrinsics.json)。
    // いずれか 1 つでも失敗したら全体を error 扱い (= 部分成功は禁止、 bundle 整合性が崩れる)。
    const uploadTasks: Array<{ name: string; uri: string; url: string; contentType: string; required: boolean }> = [
      { name: 'rgb.mp4', uri: mp4Uri, url: upload.files['rgb.mp4'].url, contentType: upload.files['rgb.mp4'].contentType, required: true },
      { name: 'sensors.jsonl', uri: sensorsUri, url: upload.files['sensors.jsonl'].url, contentType: upload.files['sensors.jsonl'].contentType, required: true },
      { name: 'imu_high_rate.jsonl', uri: imuUri, url: upload.files['imu_high_rate.jsonl'].url, contentType: upload.files['imu_high_rate.jsonl'].contentType, required: true },
      { name: 'camera_intrinsics.json', uri: intrinsicsUri, url: upload.files['camera_intrinsics.json'].url, contentType: upload.files['camera_intrinsics.json'].contentType, required: true },
    ];

    await Promise.all(uploadTasks.map(async (task) => {
      const fileInfo = await FileSystem.getInfoAsync(task.uri);
      if (!fileInfo.exists) {
        if (task.required) throw new Error(`${task.name} not found in session dir`);
        return;
      }
      const res = await FileSystem.uploadAsync(task.url, task.uri, {
        httpMethod: 'PUT',
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers: { 'Content-Type': task.contentType },
      });
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`R2 PUT failed for ${task.name}: ${res.status} ${res.body?.slice(0, 200) ?? ''}`);
      }
    }));
    this.update(serverClip.id, { uploadProgress: 1 });

    // 4. POST /api/clips/:id/finalize → サーバ workflow 起動
    const finRes = await fetch(`${serverUrl}/api/clips/${serverClip.id}/finalize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Wallet-Pubkey': walletPubkey,
      },
      body: JSON.stringify({ contentHash }),
    });
    if (!finRes.ok) throw new Error(`POST /api/clips/${serverClip.id}/finalize failed: ${finRes.status}`);
    const { clip: finalized } = await finRes.json();
    this.applyServerClip(finalized);

    // 5. polling 開始 (= 2 秒間隔、 terminal state で停止)
    this.startHttpPolling(serverClip.id);
  }

  private async httpStake(clipId: string): Promise<void> {
    const serverUrl = getServerBaseUrl();
    if (!serverUrl) throw new Error('EXPO_PUBLIC_SERVER_URL not set');
    const walletPubkey = getDemoWalletPubkey()?.toBase58();
    if (!walletPubkey) throw new Error('No wallet pubkey available');

    const res = await fetch(`${serverUrl}/api/clips/${clipId}/stake`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Wallet-Pubkey': walletPubkey,
      },
      body: JSON.stringify({}),
    });
    if (!res.ok) throw new Error(`POST stake failed: ${res.status}`);
    const { clip: staked } = await res.json();
    this.applyServerClip(staked);
  }

  private startHttpPolling(clipId: string): void {
    if (this.httpPollers.has(clipId)) return;
    const serverUrl = getServerBaseUrl();
    const walletPubkey = getDemoWalletPubkey()?.toBase58();
    if (!serverUrl || !walletPubkey) return;

    const tick = async () => {
      try {
        const res = await fetch(`${serverUrl}/api/clips/${clipId}`, {
          headers: { 'X-Wallet-Pubkey': walletPubkey },
        });
        if (!res.ok) return;
        const { clip } = await res.json();
        this.applyServerClip(clip);
        if (clip.state === 'ready' || clip.state === 'error' || clip.state === 'staked') {
          this.stopHttpPolling(clipId);
        }
      } catch {
        // 一時的なネットワークエラーは黙って次の tick に任せる
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

  private cancelTimers(id: string): void {
    const ts = this.pipelineTimers.get(id);
    if (ts) {
      for (const t of ts) clearTimeout(t);
      this.pipelineTimers.delete(id);
    }
  }

  /// ── fake パイプライン駆動 ──
  /// アップロード 8 秒 → サーバ処理 6 ステップ × 約 2 秒 = 12 秒 → 必ず ready
  /// 品質スコアは閾値による棄却を行わないので (= SPECS §6.3)、 状態としては必ず ready に遷移する。
  /// 本実装では simulatePipeline 全体を WebSocket / SSE / polling で server からの状態を反映するロジックに置き換える。
  private simulatePipeline(id: string, _mcapUri: string): void {
    this.cancelTimers(id);
    const timers: ReturnType<typeof setTimeout>[] = [];
    this.pipelineTimers.set(id, timers);

    // アップロード進捗 (= 8 秒で 0→1)
    const uploadMs = 8_000;
    const uploadStep = 200;
    let elapsed = 0;
    const tickUpload = () => {
      const cur = this.clips.get(id);
      if (!cur || cur.state !== 'uploading') return;
      elapsed += uploadStep;
      const p = Math.min(1, elapsed / uploadMs);
      this.update(id, { uploadProgress: p });
      if (p < 1) {
        timers.push(setTimeout(tickUpload, uploadStep));
      } else {
        // → processing
        const steps: ProcessingStep[] = [
          'c2pa-verify', 'anonymize', 'derive-manifest', 'quality-eval', 'tp-submit', 'r2-place',
        ];
        this.update(id, { state: 'processing', processingStep: steps[0] });
        let stepIdx = 0;
        const advance = () => {
          stepIdx += 1;
          const cur2 = this.clips.get(id);
          if (!cur2 || cur2.state !== 'processing') return;
          if (stepIdx < steps.length) {
            this.update(id, { processingStep: steps[stepIdx] });
            timers.push(setTimeout(advance, 2_000));
          } else {
            // 全ステップ完了。 必ず ready に遷移 (= 棄却閾値なし)。
            this.update(id, {
              state: 'ready',
              processingStep: undefined,
              rootAssetId: makeFakeAssetId(),
              qualityScore: mockQualityScore(),
              qualityBreakdown: mockQualityBreakdown(),
              reward: mockReward(),
              delegate: null,
            });
          }
        };
        timers.push(setTimeout(advance, 2_000));
      }
    };
    timers.push(setTimeout(tickUpload, uploadStep));
  }
}

// ─── ヘルパー ─────────────────────────────────────────────────────────

function makeClipId(): string {
  return `clip_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function makeFakeAssetId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789';
  let out = '';
  for (let i = 0; i < 44; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function mockQualityScore(): number {
  // 60〜95 で正規分布気味に
  return Math.round(60 + Math.random() * 35);
}

function mockQualityBreakdown(opts: { poor?: boolean } = {}): QualityBreakdown {
  const poor = opts.poor === true;
  return {
    anyHandRatio: poor ? 0.18 : 0.5 + Math.random() * 0.45,
    twoHandRatio: poor ? 0.08 : 0.25 + Math.random() * 0.5,
    depthValidRatio: null,  // LiDAR 非搭載 (iPhone 12) を想定
    syncRatio: 0.8 + Math.random() * 0.2,
    frameGapCount: poor ? 12 : Math.floor(Math.random() * 3),
  };
}

function mockReward(): ClipReward {
  const low = 0.6 + Math.random() * 0.6;
  return { rangeUsdcLow: +low.toFixed(2), rangeUsdcHigh: +(low + 0.8 + Math.random() * 1.2).toFixed(2) };
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
    case 'c2pa-verify':     return '署名を事前検証中';
    case 'anonymize':       return '顔と文字をぼかし中';
    case 'derive-manifest': return '派生 C2PA 署名を生成中';
    case 'quality-eval':    return '品質を評価中';
    case 'tp-submit':       return 'TP に提出して Root NFT 発行中';
    case 'r2-place':        return '配信ストレージに配置中';
    default:                return '';
  }
}

export function processingStepIndex(step: ProcessingStep | undefined): number {
  switch (step) {
    case 'c2pa-verify':     return 1;
    case 'anonymize':       return 2;
    case 'derive-manifest': return 3;
    case 'quality-eval':    return 4;
    case 'tp-submit':       return 5;
    case 'r2-place':        return 6;
    default:                return 0;
  }
}

export const PROCESSING_TOTAL_STEPS = 6;

// File 一時的に保持する不要 export 防止のため、 ensure unused warning ガード
void FileSystem;

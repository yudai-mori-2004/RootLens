// Portfolio 画面のデータ層 (= Layer 3 UI binding)。
//
// クリップは 3 ソースをマージして 1 つの Clip[] にする:
//   1. サーバ GET /api/clips        登録済み (processing / ready / staked / error) を full ClipDto で
//   2. ローカル store (useClips)     まだ未登録 (= rootAssetId 無し、 撮影中 / Pipeline1 エラー) を補完
//   3. オンチェーン DAS              revenue / licenseCount を rootAssetId でオーバーレイ (= 集計の正)
//
// dedup は rootAssetId で行う (= rootAssetId が付く ⟺ サーバ登録済み)。 ローカルは rootAssetId 無しの
// ものだけ採用するので二重表示しない。 そこから派生メトリクス (時間 / 収益のトータル・系列) と
// セクション分類 (採点待ち / 承認待ち / 販売中) を算出する。

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useAuth } from '../../services/auth';
import { useClips } from '../../clips/hooks';
import { fetchAllClips, type Clip, type ServerClipStatus } from '../../dataflow';
import { priceFromLicenseUrl } from '../../domain/licenseCatalog';
import { SOLANA_RPC_URL } from '../../env';

const DAS_URL = SOLANA_RPC_URL;
const LICENSE_COLLECTION_MINT = 'BvhuJiTWDW6n5cSzE4XmzYcwLry7vcstS1U7fD7n9N1b';
const DAILY_BARS = 14; // 日別棒グラフの日数

// ─── サーバ status → app Clip ────────────────────────────────────────
function serverStatusToClip(s: ServerClipStatus): Clip {
  return {
    id: s.id,
    state: s.state,
    createdAt: s.createdAt ? Date.parse(s.createdAt) : Date.now(),
    stage: 'registered',
    recordingConfigId: s.recordingConfig ?? undefined,
    durationMs: s.durationMs ?? null,
    deviceModel: s.deviceModel ?? null,
    contentSize: s.contentSize ?? undefined,
    qualityVector: s.qualityVector ?? null,
    summary: s.summary ?? null,
    rootAssetId: s.rootAssetId ?? undefined,
    delegate: s.delegate ?? null,
    processingStep: s.processingStep ?? null,
    errorMessage: s.errorMessage ?? null,
    previewVideoUrl: s.previewVideoUrl ?? undefined,
    licenseCount: s.licenseCount ?? 0,
    revenueUsdc: s.revenueUsdc ?? 0,
  };
}

// ─── オンチェーン (DAS) revenue 集計 ──────────────────────────────────
interface OnChainAgg {
  rootAssetId: string;
  delegate: string | null;
  createdAtUnix: number | null;
  licenseCount: number;
  revenueUsdc: number;
}

function rootMintFromUri(uri: string | null | undefined): string | null {
  if (!uri) return null;
  const m = uri.match(/[?&]root_mint=([1-9A-HJ-NP-Za-km-z]{32,44})/);
  return m ? m[1] : null;
}

async function fetchOnChainAgg(ownerBase58: string): Promise<OnChainAgg[]> {
  const ownedRes = await fetch(DAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 'rl-port-owned', method: 'getAssetsByOwner',
      params: { ownerAddress: ownerBase58, page: 1, limit: 100, sortBy: { sortBy: 'created', sortDirection: 'desc' } },
    }),
  });
  const ownedItems: any[] = (await ownedRes.json())?.result?.items ?? [];

  const licRes = await fetch(DAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 'rl-port-lic', method: 'getAssetsByGroup',
      params: { groupKey: 'collection', groupValue: LICENSE_COLLECTION_MINT, page: 1, limit: 1000 },
    }),
  });
  const licItems: any[] = (await licRes.json())?.result?.items ?? [];

  const rev = new Map<string, { count: number; usdc: number }>();
  for (const lic of licItems) {
    const uri: string | undefined =
      lic?.content?.json_uri ?? lic?.content?.metadata?.uri ?? lic?.content?.links?.uri;
    const rootMint = rootMintFromUri(uri);
    if (!rootMint) continue;
    const price = priceFromLicenseUrl(uri) ?? 0;
    const cur = rev.get(rootMint) ?? { count: 0, usdc: 0 };
    cur.count += 1;
    cur.usdc = +(cur.usdc + price).toFixed(2);
    rev.set(rootMint, cur);
  }

  return ownedItems
    .filter((a) => a?.compression?.compressed === true)
    .map((a) => {
      const r = rev.get(String(a.id)) ?? { count: 0, usdc: 0 };
      return {
        rootAssetId: String(a.id),
        delegate: a?.ownership?.delegate ?? null,
        createdAtUnix: typeof a?.compression?.created_at === 'number' ? a.compression.created_at : null,
        licenseCount: r.count,
        revenueUsdc: r.usdc,
      };
    });
}

// ─── 派生メトリクス型 ────────────────────────────────────────────────
export interface DailyBar { label: string; hours: number; isToday: boolean }
export interface RevenuePoint { t: number; cumUsdc: number }

export interface PortfolioMetrics {
  totalDurationMs: number;       // 全クリップの撮影時間合計
  dailyBars: DailyBar[];         // 直近 N 日の日別撮影時間
  totalRevenueUsdc: number;      // 確定収益合計
  soldClipsDurationMs: number;   // 売れた (licenseCount>0) クリップの撮影時間合計
  soldCount: number;             // 売れたライセンス総数 (= Σ licenseCount)
  revenueSeries: RevenuePoint[]; // 累積収益の折れ線
}

export interface PortfolioGroups {
  awaitingScoring: Clip[];   // 採点待ち (= p1-error → uploading → p2 processing/error)
  readyForApproval: Clip[];  // 採点済み・承認待ち (= ready)
  onSale: Clip[];            // 販売中 (= staked)
}

export interface PortfolioData {
  clips: Clip[];
  metrics: PortfolioMetrics;
  groups: PortfolioGroups;
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => Promise<void>;
  ownerPubkey: string | null;
}

// ─── 分類ヘルパ ──────────────────────────────────────────────────────
const isP1Error = (c: Clip) => c.state === 'error' && c.stage !== 'registered';
const isUploading = (c: Clip) => c.state === 'uploading';
const isP2Stuck = (c: Clip) => c.state === 'processing' || (c.state === 'error' && c.stage === 'registered');

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// ─── hook ────────────────────────────────────────────────────────────
export function usePortfolioData(): PortfolioData {
  const { state } = useAuth();
  const ownerPubkey = state.status === 'authenticated' ? state.session.pubkey.toBase58() : null;
  const localClips = useClips();

  const [serverClips, setServerClips] = useState<Clip[] | null>(null);
  const [onChain, setOnChain] = useState<OnChainAgg[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!ownerPubkey) {
      setServerClips([]);
      setOnChain([]);
      return;
    }
    const [server, chain] = await Promise.all([
      fetchAllClips(ownerPubkey).then((rows) => rows.map(serverStatusToClip)),
      fetchOnChainAgg(ownerPubkey).catch(() => [] as OnChainAgg[]),
    ]);
    setServerClips(server);
    setOnChain(chain);
  }, [ownerPubkey]);

  useEffect(() => { void load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  }, [load]);

  // ─── マージ ──────────────────────────────────────────────────────
  const clips: Clip[] = useMemo(() => {
    const server = serverClips ?? [];
    const chain = onChain ?? [];
    const chainByRoot = new Map(chain.map((c) => [c.rootAssetId, c]));
    const serverRoots = new Set(server.map((c) => c.rootAssetId).filter(Boolean) as string[]);

    // 1. サーバクリップ + オンチェーン revenue オーバーレイ
    const merged: Clip[] = server.map((c) => {
      const oc = c.rootAssetId ? chainByRoot.get(c.rootAssetId) : undefined;
      if (!oc) return c;
      return {
        ...c,
        // 集計の正はオンチェーン (= サーバ列がまだ集計 worker 未実装でも正しい数字を出す)。
        licenseCount: oc.licenseCount,
        revenueUsdc: oc.revenueUsdc,
        delegate: c.delegate ?? oc.delegate,
      };
    });

    // 2. ローカルの未登録クリップ (= rootAssetId 無し or サーバ未反映) を補完
    for (const lc of localClips) {
      if (!lc.rootAssetId || !serverRoots.has(lc.rootAssetId)) merged.push(lc);
    }

    // 3. サーバにもローカルにも無いオンチェーン staked (= 別経路で staked) を補完
    for (const oc of chain) {
      if (oc.delegate && !serverRoots.has(oc.rootAssetId) && !merged.some((m) => m.rootAssetId === oc.rootAssetId)) {
        merged.push({
          id: oc.rootAssetId,
          state: 'staked',
          createdAt: (oc.createdAtUnix ?? 0) * 1000,
          stage: 'registered',
          rootAssetId: oc.rootAssetId,
          delegate: oc.delegate,
          licenseCount: oc.licenseCount,
          revenueUsdc: oc.revenueUsdc,
          durationMs: null,
        });
      }
    }

    return merged.sort((a, b) => b.createdAt - a.createdAt);
  }, [serverClips, onChain, localClips]);

  // ─── 派生メトリクス ──────────────────────────────────────────────
  const metrics: PortfolioMetrics = useMemo(() => {
    let totalDurationMs = 0;
    let totalRevenueUsdc = 0;
    let soldClipsDurationMs = 0;
    let soldCount = 0;
    for (const c of clips) {
      totalDurationMs += c.durationMs ?? 0;
      const rev = c.revenueUsdc ?? 0;
      const lic = c.licenseCount ?? 0;
      totalRevenueUsdc += rev;
      soldCount += lic;
      if (lic > 0) soldClipsDurationMs += c.durationMs ?? 0;
    }
    totalRevenueUsdc = +totalRevenueUsdc.toFixed(2);

    // 日別棒グラフ (= 直近 DAILY_BARS 日)。 today を右端に。
    const today0 = startOfDay(Date.now());
    const dayMs = 86_400_000;
    const buckets = new Map<number, number>();
    for (const c of clips) {
      const d0 = startOfDay(c.createdAt);
      buckets.set(d0, (buckets.get(d0) ?? 0) + (c.durationMs ?? 0));
    }
    const dailyBars: DailyBar[] = [];
    for (let i = DAILY_BARS - 1; i >= 0; i--) {
      const d0 = today0 - i * dayMs;
      const ms = buckets.get(d0) ?? 0;
      dailyBars.push({
        label: new Date(d0).toLocaleDateString(undefined, { day: 'numeric' }),
        hours: ms / 3_600_000,
        isToday: i === 0,
      });
    }

    // 累積収益の折れ線 (= revenue>0 のクリップを createdAt 昇順で積む)。
    const earners = clips.filter((c) => (c.revenueUsdc ?? 0) > 0).sort((a, b) => a.createdAt - b.createdAt);
    let acc = 0;
    const revenueSeries: RevenuePoint[] = earners.map((c) => {
      acc = +(acc + (c.revenueUsdc ?? 0)).toFixed(2);
      return { t: c.createdAt, cumUsdc: acc };
    });

    return { totalDurationMs, dailyBars, totalRevenueUsdc, soldClipsDurationMs, soldCount, revenueSeries };
  }, [clips]);

  // ─── セクション分類 ──────────────────────────────────────────────
  const groups: PortfolioGroups = useMemo(() => {
    const p1err: Clip[] = [];
    const uploading: Clip[] = [];
    const p2: Clip[] = [];
    const readyForApproval: Clip[] = [];
    const onSale: Clip[] = [];
    for (const c of clips) {
      if (c.state === 'staked') onSale.push(c);
      else if (c.state === 'ready') readyForApproval.push(c);
      else if (isP1Error(c)) p1err.push(c);
      else if (isUploading(c)) uploading.push(c);
      else if (isP2Stuck(c)) p2.push(c);
    }
    // 採点待ちは p1-error (= 再処理可能) → uploading → p2 stuck の順。
    return { awaitingScoring: [...p1err, ...uploading, ...p2], readyForApproval, onSale };
  }, [clips]);

  return {
    clips,
    metrics,
    groups,
    loading: serverClips === null || onChain === null,
    refreshing,
    onRefresh,
    ownerPubkey,
  };
}

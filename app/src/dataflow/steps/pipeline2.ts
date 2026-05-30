// Pipeline 2 の進捗取得 (DATA_SPECS §3)。
//
// Pipeline 2 は POST /api/clips/:id/finalize で自動起動するサーバ側 workflow。
// 端末は GET /api/clips/:id を polling して processing → ready (or error) を観測する。
//
// fetchClipStatus: 1 回の状態取得。
// pollPipeline2: terminal state (ready / error / staked) になるまで polling し、 イベントを吐く。
//
// ⚠ Layer 1 (dataflow)。react / react-native を import しない。

import { SERVER_URL, SOLANA_NETWORK } from '../../env';
import type { EventSink } from '../events';
import type { ServerClipStatus } from '../types';

/** GET /api/clips/:id を 1 回叩いて状態を返す (= server surrogate id 指定)。 */
export async function fetchClipStatus(
  clipId: string,
  walletPubkey: string,
): Promise<ServerClipStatus> {
  const res = await fetch(`${SERVER_URL}/api/clips/${clipId}`, {
    headers: { 'X-Wallet-Pubkey': walletPubkey },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GET /api/clips/${clipId} ${res.status}: ${text.slice(0, 200)}`);
  }
  const { clip } = (await res.json()) as { clip: ServerClipStatus };
  return clip;
}

/** signature_hash で状態を取得する (= 端末は signature_hash で一貫。 GET /api/clips?signatureHash=&network=)。
 *  該当が無ければ null (= まだ登録されていない / 別 network)。 */
export async function fetchClipStatusByHash(
  signatureHash: string,
  walletPubkey: string,
): Promise<ServerClipStatus | null> {
  const url =
    `${SERVER_URL}/api/clips?signatureHash=${encodeURIComponent(signatureHash)}` +
    `&network=${encodeURIComponent(SOLANA_NETWORK)}`;
  const res = await fetch(url, { headers: { 'X-Wallet-Pubkey': walletPubkey } });
  if (!res.ok) return null;
  const { clips } = (await res.json()) as { clips: ServerClipStatus[] };
  return clips[0] ?? null;
}

export interface PollOptions {
  /** polling 間隔 (ms)。 既定 2000。 */
  intervalMs?: number;
  /** タイムアウト (ms)。 既定 300000 (= 5 分)。 */
  timeoutMs?: number;
  /** 各 tick の状態を受け取る callback (= store 更新用)。 */
  onStatus?: (status: ServerClipStatus) => void;
}

const TERMINAL_STATES = new Set<ServerClipStatus['state']>(['ready', 'error', 'staked']);

/**
 * Pipeline 2 を terminal state になるまで polling する。
 * processingStep の変化と state 遷移をイベントとして吐く。
 */
export async function pollPipeline2(
  clipId: string,
  walletPubkey: string,
  sink: EventSink,
  options: PollOptions = {},
): Promise<ServerClipStatus> {
  const intervalMs = options.intervalMs ?? 2000;
  const timeoutMs = options.timeoutMs ?? 300_000;
  const startTs = Date.now();

  sink({ step: 'pipeline2', level: 'info', message: `Pipeline 2 polling 開始 (clip=${clipId})` });

  let lastStep: string | null | undefined = undefined;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const status = await fetchClipStatus(clipId, walletPubkey);
    options.onStatus?.(status);

    if (status.processingStep !== lastStep) {
      lastStep = status.processingStep;
      if (status.processingStep) {
        sink({
          step: 'pipeline2',
          level: 'info',
          message: `処理ステップ: ${status.processingStep}`,
          detail: { processingStep: status.processingStep },
        });
      }
    }

    if (TERMINAL_STATES.has(status.state)) {
      if (status.state === 'error') {
        sink({
          step: 'pipeline2',
          level: 'error',
          message: `Pipeline 2 失敗: ${status.errorMessage ?? '(no message)'}`,
          detail: status,
        });
      } else {
        sink({
          step: 'pipeline2',
          level: 'success',
          message: `Pipeline 2 完了 state=${status.state}`,
          detail: { qualityVector: status.qualityVector },
        });
      }
      return status;
    }

    if (Date.now() - startTs > timeoutMs) {
      sink({
        step: 'pipeline2',
        level: 'warn',
        message: `Pipeline 2 polling タイムアウト (${Math.round(timeoutMs / 1000)}s)。 state=${status.state}`,
      });
      return status;
    }

    await delay(intervalMs);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Pipeline 3 の起動 + 結果取得 (DATA_SPECS §4)。
//
// ⚠ 現状の制約:
//   Pipeline 3 (= WiLoR 手ポーズ推定) は仕様上「RootLens チームが手動でトリガー」(§4.1) であり、
//   実体は Modal CLI (tools/modal/wilor.py) の直接実行。 端末/web から自動起動する
//   endpoint は web 側に未実装 (= 2026-05-28 時点)。
//
//   この step はその endpoint が将来追加される前提で規約的な URL を叩く。 未実装 (404) の間は
//   その事実を正直にイベントへ出す (= 嘘の成功を出さない)。 出力は processed/<signature_hash>/wilor.jsonl。
//
// ⚠ Layer 1 (dataflow)。react / react-native を import しない。

import { SERVER_URL } from '../../env';
import type { EventSink } from '../events';

export interface Pipeline3TriggerResult {
  /** server がトリガーを受理したか (= endpoint が存在し 2xx を返したか) */
  triggered: boolean;
  /** server が返した生レスポンス (= デバッグ表示用) */
  raw?: unknown;
}

const PIPELINE3_UNIMPLEMENTED_NOTE =
  'Pipeline 3 は仕様上 手動 ops トリガー (Modal CLI)。 web 側に自動起動 endpoint が未実装です。' +
  ' 別タスクで POST /api/clips/:id/pipeline3 を新設するまで、 ここからは起動できません。';

/**
 * Pipeline 3 を起動する (= 規約的 endpoint POST /api/clips/:id/pipeline3)。
 * endpoint 未実装 (404) の間は warn を出して triggered=false を返す。
 */
export async function triggerPipeline3(
  clipId: string,
  walletPubkey: string,
  sink: EventSink,
): Promise<Pipeline3TriggerResult> {
  sink({ step: 'pipeline3', level: 'info', message: 'Pipeline 3 起動を試行 (POST /api/clips/:id/pipeline3)' });
  let res: Response;
  try {
    res = await fetch(`${SERVER_URL}/api/clips/${clipId}/pipeline3`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Wallet-Pubkey': walletPubkey,
      },
      body: JSON.stringify({}),
    });
  } catch (e) {
    sink({
      step: 'pipeline3',
      level: 'error',
      message: `ネットワークエラー: ${e instanceof Error ? e.message : String(e)}`,
    });
    return { triggered: false };
  }

  if (res.status === 404) {
    sink({ step: 'pipeline3', level: 'warn', message: PIPELINE3_UNIMPLEMENTED_NOTE });
    return { triggered: false };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    sink({
      step: 'pipeline3',
      level: 'error',
      message: `Pipeline 3 起動失敗 ${res.status}: ${text.slice(0, 200)}`,
    });
    return { triggered: false };
  }

  const raw = await res.json().catch(() => null);
  sink({ step: 'pipeline3', level: 'success', message: 'Pipeline 3 を起動', detail: raw });
  return { triggered: true, raw };
}

/**
 * Pipeline 3 の結果状態を取得する (= 規約的 endpoint GET /api/clips/:id/pipeline3)。
 * endpoint 未実装 (404) の間は warn を出して null を返す。
 */
export async function fetchPipeline3Status(
  clipId: string,
  walletPubkey: string,
  sink: EventSink,
): Promise<unknown | null> {
  sink({ step: 'pipeline3', level: 'info', message: 'Pipeline 3 結果を取得 (GET /api/clips/:id/pipeline3)' });
  let res: Response;
  try {
    res = await fetch(`${SERVER_URL}/api/clips/${clipId}/pipeline3`, {
      headers: { 'X-Wallet-Pubkey': walletPubkey },
    });
  } catch (e) {
    sink({
      step: 'pipeline3',
      level: 'error',
      message: `ネットワークエラー: ${e instanceof Error ? e.message : String(e)}`,
    });
    return null;
  }

  if (res.status === 404) {
    sink({ step: 'pipeline3', level: 'warn', message: PIPELINE3_UNIMPLEMENTED_NOTE });
    return null;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    sink({
      step: 'pipeline3',
      level: 'error',
      message: `Pipeline 3 結果取得失敗 ${res.status}: ${text.slice(0, 200)}`,
    });
    return null;
  }

  const raw = await res.json().catch(() => null);
  sink({ step: 'pipeline3', level: 'success', message: 'Pipeline 3 結果を取得', detail: raw });
  return raw;
}

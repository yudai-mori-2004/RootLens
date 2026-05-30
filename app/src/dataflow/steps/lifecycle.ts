// クリップのライフサイクル操作 step (= stake)。
//
//   stakeClip  POST /api/clips/:id/stake   ready → staked (= Bubblegum delegate 委譲)
//
// 端末はクリップを signature_hash で一意に扱うが、 サーバ REST は surrogate id (= clip_<hash12>_<ts>)
// を resource id に使う。 そこで signature_hash → server id を GET /api/clips?signatureHash= で解決して叩く。
// 返値は更新後の ClipDto。 呼び出し側 (UI) は applyServerStatus で store (= signature_hash keyed) に反映する。
//
// 注: Pipeline 2 の再試行 (= /retry) は端末からは行わない (= コスト高、 server ops の責務)。
//     Pipeline 1 段の再試行は dataflow/pipeline.ts の advanceClip が担う。
// 注: remove (= 破棄) はサーバ呼び出しを伴わないローカル操作なので store.removeClip を直接使う。
//
// ⚠ Layer 1 (dataflow)。react / react-native を import しない。

import { SERVER_URL, SOLANA_NETWORK } from '../../env';
import type { EventSink } from '../events';
import type { ServerClipStatus } from '../types';

/** signature_hash → サーバ surrogate clip id を解決する (= GET /api/clips?signatureHash=&network=)。 */
export async function resolveServerClipId(
  signatureHash: string,
  walletPubkey: string,
): Promise<string | null> {
  const url =
    `${SERVER_URL}/api/clips?signatureHash=${encodeURIComponent(signatureHash)}` +
    `&network=${encodeURIComponent(SOLANA_NETWORK)}`;
  const res = await fetch(url, { headers: { 'X-Wallet-Pubkey': walletPubkey } });
  if (!res.ok) return null;
  const { clips } = (await res.json()) as { clips: Array<{ id: string }> };
  return clips[0]?.id ?? null;
}

/** POST /api/clips/:id/stake → 更新後の clip 状態を返す (= signature_hash から id を解決して叩く)。 */
export async function stakeClip(
  signatureHash: string,
  walletPubkey: string,
  sink: EventSink,
): Promise<ServerClipStatus> {
  sink({ step: 'stake', level: 'info', message: 'ステーキング: server clip id を解決' });
  const id = await resolveServerClipId(signatureHash, walletPubkey);
  if (!id) throw new Error('stake 対象のクリップがサーバに見つかりません (signature_hash 未登録)');

  const res = await fetch(`${SERVER_URL}/api/clips/${id}/stake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Wallet-Pubkey': walletPubkey },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`/api/clips/${id}/stake ${res.status}: ${text.slice(0, 200)}`);
  }
  const { clip } = (await res.json()) as { clip: ServerClipStatus };
  sink({ step: 'stake', level: 'success', message: `ステーキング完了 state=${clip.state}` });
  return clip;
}

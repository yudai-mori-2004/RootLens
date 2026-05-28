// Pipeline 1 step: サーバ登録 + Pipeline 2 起動 (DATA_SPECS §2.7 / §3.1)。
//
//   1. POST /api/clips        rootAssetId + signedJsonUri 付きで clip 行を作成
//   2. POST /api/clips/:id/finalize   Pipeline 2 (= 品質スコアリング workflow) を起動
//
// rootAssetId 未確定のまま呼んではならない (= server 側 zod が必須)。
//
// ⚠ Layer 1 (dataflow)。react / react-native を import しない。

import { SERVER_URL } from '../../env';
import type { EventSink } from '../events';
import type { RegisterInput, RegisterResult } from '../types';

export async function registerClip(
  input: RegisterInput,
  sink: EventSink,
): Promise<RegisterResult> {
  // ─── POST /api/clips ─────────────────────────────────────────────
  sink({ step: 'register-clip', level: 'info', message: 'POST /api/clips (clip 行作成)' });
  const clipId = await postClip(input);
  sink({
    step: 'register-clip',
    level: 'success',
    message: `clip 登録完了 id=${clipId}`,
    detail: { clipId },
  });

  // ─── POST /api/clips/:id/finalize → Pipeline 2 起動 ───────────────
  sink({ step: 'finalize', level: 'info', message: 'POST /api/clips/:id/finalize (Pipeline 2 起動)' });
  await finalizeClip(clipId, input.signatureHash, input.walletPubkey);
  sink({ step: 'finalize', level: 'success', message: 'Pipeline 2 を起動 (processing 遷移)' });

  return { clipId };
}

// ─── 内部 ─────────────────────────────────────────────────────────────

async function postClip(input: RegisterInput): Promise<string> {
  const res = await fetch(`${SERVER_URL}/api/clips`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Wallet-Pubkey': input.walletPubkey,
    },
    body: JSON.stringify({
      signatureHash: input.signatureHash,
      contentSize: input.contentSize,
      rootAssetId: input.rootAssetId,
      signedJsonUri: input.signedJsonUri,
    }),
  });
  if (!(res.status === 200 || res.status === 201)) {
    const text = await res.text().catch(() => '');
    throw new Error(`/api/clips ${res.status}: ${text.slice(0, 200)}`);
  }
  const { clip } = (await res.json()) as { clip: { id: string } };
  return clip.id;
}

async function finalizeClip(
  clipId: string,
  signatureHash: string,
  walletPubkey: string,
): Promise<void> {
  const res = await fetch(`${SERVER_URL}/api/clips/${clipId}/finalize`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Wallet-Pubkey': walletPubkey,
    },
    body: JSON.stringify({ signatureHash }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`/api/clips/${clipId}/finalize ${res.status}: ${text.slice(0, 200)}`);
  }
}

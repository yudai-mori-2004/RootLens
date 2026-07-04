// Pipeline 1 step: サーバ登録 (DATA_SPECS §2.5)。
//
// v0.1.4: POST /api/clips でクリップ行を作るだけ。 finalize / TP /process / mint は無い。
//
// ⚠ Layer 1 (dataflow)。react / react-native を import しない。

import { SERVER_URL, SOLANA_NETWORK } from '../../env';
import type { EventSink } from '../events';
import type { RegisterInput, RegisterResult } from '../types';

export async function registerClip(
  input: RegisterInput,
  sink: EventSink,
): Promise<RegisterResult> {
  sink({ step: 'register-clip', level: 'info', message: 'POST /api/clips (clip 行作成)' });
  const res = await fetch(`${SERVER_URL}/api/clips`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Wallet-Pubkey': input.walletPubkey,
    },
    body: JSON.stringify({
      signatureHash: input.signatureHash,
      contentSize: input.contentSize,
      network: SOLANA_NETWORK,
      recordingConfig: input.recordingConfig,
      ...(input.durationMs != null ? { durationMs: input.durationMs } : {}),
      ...(input.deviceModel ? { deviceModel: input.deviceModel } : {}),
    }),
  });
  if (!(res.status === 200 || res.status === 201)) {
    const text = await res.text().catch(() => '');
    throw new Error(`/api/clips ${res.status}: ${text.slice(0, 200)}`);
  }
  const { clip } = (await res.json()) as { clip: { id: string } };
  sink({
    step: 'register-clip',
    level: 'success',
    message: `clip 登録完了 id=${clip.id}`,
    detail: { clipId: clip.id },
  });
  return { clipId: clip.id };
}

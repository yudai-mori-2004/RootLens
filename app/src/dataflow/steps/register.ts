// Pipeline 1 step: サーバ登録 (DATA_SPECS §2.5)。
//
// v0.1.4: POST /api/clips でクリップ行を作るだけ。 R2 アップロード完了後に呼ぶ。
// 所有者は Bearer token の sub でサーバが決める (task 13)。 同意イベント id も
// ここで行に保存される (= クリップ ⇔ 同意証跡の結合)。
//
// ⚠ Layer 1 (dataflow)。react / react-native を import しない。

import { SERVER_URL } from '../../env';
import { getAuthHeader } from '../../services/auth/instance';
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
      ...(await getAuthHeader()),
    },
    body: JSON.stringify({
      contentHash: input.contentHash,
      contentSize: input.contentSize,
      recordingConfig: input.recordingConfig,
      ...(input.durationMs != null ? { durationMs: input.durationMs } : {}),
      ...(input.deviceModel ? { deviceModel: input.deviceModel } : {}),
      ...(input.consentEventId ? { consentEventId: input.consentEventId } : {}),
    }),
  });
  if (!(res.status === 200 || res.status === 201)) {
    const text = await res.text().catch(() => '');
    throw new Error(`/api/clips ${res.status}: ${text.slice(0, 200)}`);
  }
  const { clip } = (await res.json()) as { clip: { contentHash: string } };
  sink({
    step: 'register-clip',
    level: 'success',
    message: `clip 登録完了 content_hash=${clip.contentHash.slice(0, 12)}…`,
    detail: { clipId: clip.contentHash },
  });
  return { clipId: clip.contentHash };
}

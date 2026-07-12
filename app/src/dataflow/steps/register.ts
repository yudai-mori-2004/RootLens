// Upload step: register the clip with the server.
//
// Creates the clip row with POST /api/clips, called after the R2 upload
// completes. The server derives the owner from the Bearer token's subject.
// The consent event id is stored on the row here, which is what ties a clip
// to its consent record.
//
// ⚠ Dataflow layer: must not import react / react-native.

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

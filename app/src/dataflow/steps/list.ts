// Fetch the account's clips from the server (GET /api/clips).
//
// Used for the "total recorded time" statistic (summing durationMs over
// uploaded clips). The clip list UI itself trusts the local store (it only
// shows clips waiting to upload), so this step is a read-only side channel.
// The account comes from the Bearer token on the server side.
//
// ⚠ Dataflow layer: must not import react / react-native.

import { SERVER_URL } from '../../env';
import { getAuthHeader } from '../../services/auth/instance';
import type { ServerClipStatus } from '../types';

export async function fetchMyClips(): Promise<ServerClipStatus[]> {
  const res = await fetch(`${SERVER_URL}/api/clips`, {
    headers: await getAuthHeader(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GET /api/clips ${res.status}: ${text.slice(0, 200)}`);
  }
  const { clips } = (await res.json()) as { clips: ServerClipStatus[] };
  return clips;
}

/** 履歴再生 (= R2 の rgb.mp4 の presigned GET URL を取る)。 identifier は content hash。
 *  失敗理由で挙動を分けたいので、 タグ付きの `ClipMediaError` を throw する。 */
export class ClipMediaError extends Error {
  readonly kind: 'not-found' | 'unauthorized' | 'network' | 'server';
  constructor(kind: ClipMediaError['kind'], message: string) {
    super(message);
    this.kind = kind;
  }
}

export async function fetchClipMediaUrl(contentHash: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${SERVER_URL}/api/clips/${contentHash}/media`, {
      headers: await getAuthHeader(),
    });
  } catch (e) {
    // fetch 自体が throw = 実際の通信失敗 (オフライン・DNS・タイムアウト等)
    throw new ClipMediaError('network', e instanceof Error ? e.message : String(e));
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const detail = `GET /api/clips/:contentHash/media ${res.status}: ${text.slice(0, 200)}`;
    if (res.status === 404) throw new ClipMediaError('not-found', detail);
    if (res.status === 401 || res.status === 403) throw new ClipMediaError('unauthorized', detail);
    throw new ClipMediaError('server', detail);
  }
  const { url } = (await res.json()) as { url: string };
  return url;
}

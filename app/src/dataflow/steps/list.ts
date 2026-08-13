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

/** API 失敗の理由タグ (= 呼び出し側が「無い」「未認証」「通信」「サーバ」 で表示を分ける)。 */
export class ClipApiError extends Error {
  readonly kind: 'not-found' | 'unauthorized' | 'network' | 'server';
  constructor(kind: ClipApiError['kind'], message: string) {
    super(message);
    this.kind = kind;
  }
}

export async function fetchMyClips(): Promise<ServerClipStatus[]> {
  let res: Response;
  try {
    res = await fetch(`${SERVER_URL}/api/clips`, {
      headers: await getAuthHeader(),
    });
  } catch (e) {
    throw new ClipApiError('network', e instanceof Error ? e.message : String(e));
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const detail = `GET /api/clips ${res.status}: ${text.slice(0, 200)}`;
    if (res.status === 401 || res.status === 403) throw new ClipApiError('unauthorized', detail);
    throw new ClipApiError('server', detail);
  }
  const { clips } = (await res.json()) as { clips: ServerClipStatus[] };
  return clips;
}

/** 履歴再生 (= R2 の rgb.mp4 の presigned GET URL を取る)。 identifier は content hash。 */

export async function fetchClipMediaUrl(contentHash: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${SERVER_URL}/api/clips/${contentHash}/media`, {
      headers: await getAuthHeader(),
    });
  } catch (e) {
    // fetch 自体が throw = 実際の通信失敗 (オフライン・DNS・タイムアウト等)
    throw new ClipApiError('network', e instanceof Error ? e.message : String(e));
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const detail = `GET /api/clips/:contentHash/media ${res.status}: ${text.slice(0, 200)}`;
    if (res.status === 404) throw new ClipApiError('not-found', detail);
    if (res.status === 401 || res.status === 403) throw new ClipApiError('unauthorized', detail);
    throw new ClipApiError('server', detail);
  }
  const { url } = (await res.json()) as { url: string };
  return url;
}

/** Mentra がアップロード済みのクリップへ、 iPhone で取得した同意を結び付ける。 */
export async function attachClipConsent(
  contentHash: string,
  consentEventId: string,
): Promise<ServerClipStatus> {
  let res: Response;
  try {
    res = await fetch(`${SERVER_URL}/api/clips/${contentHash}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(await getAuthHeader()),
      },
      body: JSON.stringify({ consentEventId }),
    });
  } catch (e) {
    throw new ClipApiError('network', e instanceof Error ? e.message : String(e));
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const detail = `PATCH /api/clips/:contentHash ${res.status}: ${text.slice(0, 200)}`;
    if (res.status === 404) throw new ClipApiError('not-found', detail);
    if (res.status === 401 || res.status === 403) throw new ClipApiError('unauthorized', detail);
    throw new ClipApiError('server', detail);
  }
  const { clip } = (await res.json()) as { clip: ServerClipStatus };
  return clip;
}

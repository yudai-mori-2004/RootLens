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

/** For history playback: fetch a presigned GET URL for the clip's rgb.mp4
 *  (streams straight from R2). The identifier is the content hash. */
export async function fetchClipMediaUrl(contentHash: string): Promise<string> {
  const res = await fetch(`${SERVER_URL}/api/clips/${contentHash}/media`, {
    headers: await getAuthHeader(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GET /api/clips/:contentHash/media ${res.status}: ${text.slice(0, 200)}`);
  }
  const { url } = (await res.json()) as { url: string };
  return url;
}

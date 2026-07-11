// サーバのクリップ一覧取得 (= GET /api/clips)。
//
// v0.1.4 では「これまでの撮影時間」 の集計に使う (= uploaded 済みクリップの durationMs 合算)。
// 一覧 UI そのものはローカル store が真実 (= アップロード待ちのみ表示) なので、
// この step は統計用の読み取り専用。 アカウントは Bearer token でサーバが決める (task 13)。
//
// ⚠ Layer 1 (dataflow)。react / react-native を import しない。

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

/** 履歴再生用: クリップの rgb.mp4 presigned GET URL を取得する (= R2 からストリーミング再生)。
 *  識別子は content_hash。 */
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

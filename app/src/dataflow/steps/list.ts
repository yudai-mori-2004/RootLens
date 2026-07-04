// サーバのクリップ一覧取得 (= GET /api/clips)。
//
// v0.1.4 では「これまでの撮影時間」 の集計に使う (= uploaded 済みクリップの durationMs 合算)。
// 一覧 UI そのものはローカル store が真実 (= アップロード待ちのみ表示) なので、
// この step は統計用の読み取り専用。
//
// ⚠ Layer 1 (dataflow)。react / react-native を import しない。

import { SERVER_URL } from '../../env';
import type { ServerClipStatus } from '../types';

export async function fetchMyClips(accountPubkey: string): Promise<ServerClipStatus[]> {
  const res = await fetch(`${SERVER_URL}/api/clips`, {
    headers: { 'X-Account-Pubkey': accountPubkey },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GET /api/clips ${res.status}: ${text.slice(0, 200)}`);
  }
  const { clips } = (await res.json()) as { clips: ServerClipStatus[] };
  return clips;
}

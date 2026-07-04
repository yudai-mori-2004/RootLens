// アップロード済みクリップのサムネイル永続化。
//
// アップロード完了後はローカルの録画ファイルを掃除する (= 容量) が、 マイビデオの
// 「アップロード済み履歴」 で見返せるように、 サムネ 1 枚だけ Documents 配下に残す。
// サーバ側には取得口が無い前提の、 端末ローカルな記憶。
//
// ⚠ Layer 1 (dataflow)。react / react-native を import しない。

import * as FileSystem from 'expo-file-system';
import * as VideoThumbnails from 'expo-video-thumbnails';

const THUMBS_DIR = `${FileSystem.documentDirectory}thumbs/`;

/** signature_hash のサムネ保存先 (= 存在すれば履歴タイルが使う)。 */
export function thumbPath(signatureHash: string): string {
  return `${THUMBS_DIR}${signatureHash}.jpg`;
}

/**
 * 署名済み mp4 からサムネを 1 枚生成して永続保存する (= best-effort、 失敗しても致命ではない)。
 * アップロード完了 (= register 後、 録画ファイル掃除の前) に呼ぶ。
 */
export async function persistClipThumbnail(videoUri: string, signatureHash: string): Promise<void> {
  try {
    await FileSystem.makeDirectoryAsync(THUMBS_DIR, { intermediates: true }).catch(() => {});
    const { uri } = await VideoThumbnails.getThumbnailAsync(videoUri, { time: 800, quality: 0.5 });
    await FileSystem.moveAsync({ from: uri, to: thumbPath(signatureHash) });
  } catch {
    // サムネ無しでも履歴はプレースホルダで表示できる
  }
}

/** 保存済みサムネの signature_hash 一覧 (= 履歴タイルの存在チェック用 index)。 */
export async function listThumbHashes(): Promise<Set<string>> {
  try {
    const names = await FileSystem.readDirectoryAsync(THUMBS_DIR);
    return new Set(names.filter((n) => n.endsWith('.jpg')).map((n) => n.slice(0, -4)));
  } catch {
    return new Set();
  }
}

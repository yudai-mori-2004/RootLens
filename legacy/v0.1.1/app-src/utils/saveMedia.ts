import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system';

/**
 * C2PA署名済みメディアをギャラリーに保存する。
 * ファイル名: RL_YYYYMMDD_HHmmss_NNN.ext
 */
export async function saveToGallery(uri: string): Promise<MediaLibrary.Asset> {
  // ファイル名を生成
  const now = new Date();
  const ts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '_',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('');
  const rand = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
  const ext = uri.match(/\.(\w+)$/)?.[1] || 'jpg';
  const filename = `RL_${ts}_${rand}.${ext}`;

  // 一時ファイルをリネーム（ファイル名を反映させるため）
  const destUri = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.copyAsync({ from: uri, to: destUri });

  const asset = await MediaLibrary.createAssetAsync(destUri);

  // 一時ファイル削除
  await FileSystem.deleteAsync(destUri, { idempotent: true });

  return asset;
}

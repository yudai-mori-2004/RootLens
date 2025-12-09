// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RootLens Ver4 - R2 Path Utilities
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * original_hashからmanifest.jsonのR2パスを導出
 *
 * @param originalHash - 元ファイルのSHA-256ハッシュ
 * @returns manifest.jsonのR2パス
 *
 * @example
 * const path = getManifestPath("17c9e5b9f40ef79bb8e8af4adf36fe2be54d9c4a...");
 * // => "media/17c9e5b9f40ef79bb8e8af4adf36fe2be54d9c4a.../manifest.json"
 */
export function getManifestPath(originalHash: string): string {
  return `media/${originalHash}/manifest.json`;
}

/**
 * original_hashから元ファイルのR2パスを導出
 *
 * @param originalHash - 元ファイルのSHA-256ハッシュ
 * @param extension - ファイル拡張子（例: "jpg", "png", "mp4"）
 * @returns 元ファイルのR2パス
 *
 * @example
 * const path = getMediaPath("17c9e5b9...", "jpg");
 * // => "media/17c9e5b9.../original.jpg"
 */
export function getMediaPath(originalHash: string, extension: string): string {
  return `media/${originalHash}/original.${extension}`;
}

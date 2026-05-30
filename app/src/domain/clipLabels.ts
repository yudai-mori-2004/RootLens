// クリップ表示ラベル (= 純粋関数、 presentation 層の helper)。
//
// クリップの一意 id = signature_hash (= blur 後 D2 署名で確定する確定動画の id) を表示用に整形する。
// 旧 autoCategory (8 値カテゴリ) は廃止、 旧 3 段 ProcessingStep 表示も廃止 (= サーバは単一 scoring
// ステップ + 不確定ローディング表示に移行)。

/**
 * クリップ一覧 / 詳細で出すタイトル。 signature_hash の短縮表示。
 * まだ署名前 (= signature_hash 未確定) は「署名処理中…」。
 */
export function clipTitle(clip: { signatureHash?: string }): string {
  return clip.signatureHash ? `${clip.signatureHash.slice(0, 16)}…` : '署名処理中…';
}

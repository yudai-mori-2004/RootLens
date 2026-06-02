// クリップ表示ラベル (= 純粋関数、 presentation 層の helper)。
//
// 主婦が一目でわかる「動画の正体」 を出す。 優先順位:
//   1. summary (= Pipeline 2 の AI 要約、 例「食器を洗っている」)。 人が読める正体。
//   2. 撮影日時 (= 要約がまだ無い撮影中/準備中の動画)。
// signature_hash (= 64 桁 hex) は絶対に出さない (= ユーザーに意味がない)。

import { getLocale } from '../i18n';

export function clipTitle(clip: { summary?: string | null; createdAt?: number }): string {
  const s = clip.summary?.trim();
  if (s) return s;
  if (clip.createdAt) return formatCaptureLabel(clip.createdAt);
  return getLocale() === 'en' ? 'Untitled video' : '撮影した動画';
}

/** 撮影日時の親しみやすいラベル (例「5月30日 14:05」)。 */
export function formatCaptureLabel(ts: number): string {
  const tag = getLocale() === 'en' ? 'en-US' : 'ja-JP';
  return new Date(ts).toLocaleString(tag, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

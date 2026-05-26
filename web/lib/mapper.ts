import type { Clip } from "@/db/schema";
import type { ClipDto, ClipState, ProcessingStep } from "@/shared/api-types";
import { presignRawGet } from "@/lib/r2";

// DB row → API DTO 変換。 client が見るのはこれだけ。
// 機微情報 (= raw R2 key 等のサーバ内部識別子) は意図的に省く。

export async function clipToDto(row: Clip): Promise<ClipDto> {
  // C2PA D2 署名済の rgb.mp4 (= R2 raw バケット内) を撮影者プレビューに使う。
  // v0.1.2 では別バケットの blurred MP4 を使っていたが、 v0.1.3 では端末が直接
  // 署名 + ぼかし済を raw バケットにあげる構造。
  let previewVideoUrl: string | null = null;
  if (row.signedMp4Key) {
    try {
      previewVideoUrl = await presignRawGet(row.signedMp4Key, 3600);
    } catch (e) {
      // signing 失敗時は null (= client 側で local snapshot に fallback)。
      // ただ silent には流さず、 認証 / バケット設定ミスの早期検知のため log する。
      console.error(`[mapper] presignRawGet failed for ${row.signedMp4Key}:`, e);
    }
  }
  return {
    id: row.id,
    taskId: row.taskId,
    state: row.state as ClipState,
    createdAt: row.createdAt.toISOString(),
    achievementConfidence: row.achievementConfidence,
    processingStep: row.processingStep as ProcessingStep | null,
    qualityScore: row.qualityScore,
    qualityBreakdown: row.qualityBreakdown,
    rootAssetId: row.rootAssetId,
    delegate: row.delegate,
    licenseCount: row.licenseCount,
    revenueUsdc: Number(row.revenueUsdc),
    errorMessage: row.errorMessage,
    previewVideoUrl,
  };
}

/// 複数行を並列に DTO 化 (= list 系 endpoint 用)。
export async function clipsToDtos(rows: Clip[]): Promise<ClipDto[]> {
  return await Promise.all(rows.map(clipToDto));
}

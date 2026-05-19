import type { Clip } from "@/db/schema";
import type { ClipDto, ClipState, ProcessingStep } from "@/shared/api-types";
import { presignBlurredGet } from "@/lib/r2";

// DB row → API DTO 変換。 client が見るのはこれだけ。
// 機微情報 (= raw R2 key 等のサーバ内部識別子) は意図的に省く。
//
// preview MP4 の事前署名 GET URL を含めるため async。 R2 への signing 計算は CPU only、 1 ms 未満。
export async function clipToDto(row: Clip): Promise<ClipDto> {
  // ぼかし済 MP4 (= Pipeline 2 出力) を Stake シートで preview する。
  // Pipeline 3 の LeRobot dataset とは別、 こちらは撮影者が見るためのもの。
  let previewVideoUrl: string | null = null;
  if (row.blurredMp4Key) {
    try {
      previewVideoUrl = await presignBlurredGet(row.blurredMp4Key, 3600);
    } catch {
      // signing 失敗時は null (= client は local snapshot に fallback)
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

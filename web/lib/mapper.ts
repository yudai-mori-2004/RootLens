import type { Clip } from "@/db/schema";
import type { AutoCategory, ClipDto, ClipState, ProcessingStep } from "@/shared/api-types";
import { presignRawGet } from "@/lib/r2";

// DB row → API DTO 変換。 client が見るのはこれだけ。
// 機微情報 (= raw R2 key 等のサーバ内部識別子) は意図的に省く。
// 2026-05-27 方針転換: taskId / achievementConfidence は ClipDto から撤去 (= legacy)。
// 代わりに autoCategory + autoCategoryConfidence を含める。 db schema 側に列が無い間は
// null で埋める (= migration は別 task で)。

export async function clipToDto(row: Clip): Promise<ClipDto> {
  // C2PA D2 署名済の rgb.mp4 (= R2 raw バケット内) を撮影者プレビューに使う。
  let previewVideoUrl: string | null = null;
  if (row.signedMp4Key) {
    try {
      previewVideoUrl = await presignRawGet(row.signedMp4Key, 3600);
    } catch (e) {
      console.error(`[mapper] presignRawGet failed for ${row.signedMp4Key}:`, e);
    }
  }
  // db schema に autoCategory / autoCategoryConfidence 列が追加されたら、
  // row.autoCategory / row.autoCategoryConfidence を参照する。 現状は null。
  const rowAny = row as Record<string, unknown>;
  const autoCategory = (rowAny.autoCategory ?? null) as AutoCategory | null;
  const autoCategoryConfidence =
    typeof rowAny.autoCategoryConfidence === "number" ? rowAny.autoCategoryConfidence : null;

  return {
    id: row.id,
    state: row.state as ClipState,
    createdAt: row.createdAt.toISOString(),
    autoCategory,
    autoCategoryConfidence,
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

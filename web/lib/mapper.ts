import type { Clip } from "@/db/schema";
import type { ClipDto, ClipState, ProcessingStep, RecordingConfig, SolanaNetwork } from "@/shared/api-types";
import { presignRawGet } from "@/lib/r2";
import { signedMp4Key } from "@/lib/r2-keys";

// DB row → API DTO 変換。 client が見るのはこれだけ。
// 機微情報 (= raw R2 key 等のサーバ内部識別子) は意図的に省く。
// raw key は signature_hash から導出する (= 列に持たない、 DATA_SPECS §5)。

export async function clipToDto(row: Clip): Promise<ClipDto> {
  // C2PA D2 署名済の rgb.mp4 (= R2 raw バケット内) を撮影者プレビューに使う。
  // key は signature_hash から導出 (raw/<sig>/rgb.mp4)。
  let previewVideoUrl: string | null = null;
  const rawKey = signedMp4Key(row.signatureHash);
  try {
    previewVideoUrl = await presignRawGet(rawKey, 3600);
  } catch (e) {
    console.error(`[mapper] presignRawGet failed for ${rawKey}:`, e);
  }

  return {
    id: row.id,
    state: row.state as ClipState,
    createdAt: row.createdAt.toISOString(),
    processingStep: row.processingStep as ProcessingStep | null,

    recordingConfig: row.recordingConfig as RecordingConfig,
    durationMs: row.durationMs,
    contentSize: row.contentSize,
    deviceModel: row.deviceModel,

    qualityVector: row.qualityVector,
    summary: row.summary,

    rootAssetId: row.rootAssetId,
    signedJsonUri: row.signedJsonUri,
    network: (row.network as SolanaNetwork) ?? "devnet",
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

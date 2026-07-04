import type { Clip } from "@/db/schema";
import type { ClipDto, ClipState, RecordingConfig } from "@/shared/api-types";

// DB row → API DTO 変換。 client が見るのはこれだけ。
// v0.1.4: presigned preview URL の発行は不要 (= ClipDto から previewVideoUrl 撤去、 端末プレビューは
// アップロード前のローカル mp4 で済む)。

export function clipToDto(row: Clip): ClipDto {
  return {
    id: row.id,
    state: row.state as ClipState,
    createdAt: row.createdAt.toISOString(),

    recordingConfig: row.recordingConfig as RecordingConfig,
    durationMs: row.durationMs,
    contentSize: row.contentSize,
    deviceModel: row.deviceModel,

    signatureHash: row.signatureHash,

    errorMessage: row.errorMessage,
  };
}

/// 複数行を DTO 化。
export function clipsToDtos(rows: Clip[]): ClipDto[] {
  return rows.map(clipToDto);
}

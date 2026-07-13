import type { Clip } from "@/db/schema";
import type { ClipDto, RecordingConfig } from "@/shared/api-types";

// DB row → API DTO 変換。 client が見るのはこれだけ。
// 識別子は content_hash そのもの。 account_id は DTO に出さない
// (= 呼び出し元は自分のトークンで取った自分の行しか見えないので不要)。

export function clipToDto(row: Clip): ClipDto {
  return {
    contentHash: row.contentHash,
    createdAt: row.createdAt.toISOString(),

    recordingConfig: row.recordingConfig as RecordingConfig,
    durationMs: row.durationMs,
    contentSize: row.contentSize,
    deviceModel: row.deviceModel,

    consentEventId: row.consentEventId,
  };
}

/// 複数行を DTO 化。
export function clipsToDtos(rows: Clip[]): ClipDto[] {
  return rows.map(clipToDto);
}

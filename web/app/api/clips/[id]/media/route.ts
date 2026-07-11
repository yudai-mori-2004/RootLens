// GET /api/clips/:contentHash/media — 撮影者本人の履歴再生用 presigned GET URL。
//
// アップロード済みクリップの rgb.mp4 は端末から消えている (= 容量) ので、 マイビデオの
// 履歴ポップは R2 から直接ストリーミング再生する。 バケットは撮影構成で決まる
// (ultra_wide → raw / arkit → raw-arkit)。 所有チェックは (content_hash, account_id) の一致。

import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/db/client";
import { clips } from "@/db/schema";
import { requireAccountId } from "@/lib/auth";
import { presignRawGet, rawBucketFor, rawMp4Key } from "@/lib/r2";
import type { RecordingConfigId } from "@/lib/r2-keys";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let accountId: string;
  try {
    accountId = await requireAccountId(req);
  } catch (r) {
    return r as Response;
  }
  const { id: contentHash } = await params;

  const rows = await db
    .select()
    .from(clips)
    .where(and(eq(clips.contentHash, contentHash), eq(clips.accountId, accountId)))
    .limit(1);
  if (rows.length === 0) {
    return NextResponse.json({ error: "clip not found" }, { status: 404 });
  }
  const clip = rows[0];

  const expiresInSec = 3600;
  const url = await presignRawGet(
    rawMp4Key(clip.contentHash),
    rawBucketFor((clip.recordingConfig ?? "ultra_wide") as RecordingConfigId),
    expiresInSec,
  );
  return NextResponse.json({
    url,
    expiresAt: new Date(Date.now() + expiresInSec * 1000).toISOString(),
  });
}

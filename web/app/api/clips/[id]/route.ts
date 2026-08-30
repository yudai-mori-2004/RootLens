import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { clips, consentEvents } from "@/db/schema";
import { requireAccountId } from "@/lib/auth";
import { clipToDto } from "@/lib/mapper";
import { deleteRawSession, rawBucketFor } from "@/lib/r2";
import type { RecordingConfigId } from "@/lib/r2-keys";
import type {
  AttachClipConsentRequest,
  AttachClipConsentResponse,
  DeleteClipResponse,
} from "@/shared/api-types";

// path param `id` = content_hash。
interface Ctx {
  params: Promise<{ id: string }>;
}

// GET /api/clips/:contentHash ─ 単件取得 (所有アカウントのみ)
export async function GET(req: Request, ctx: Ctx) {
  let accountId: string;
  try {
    accountId = await requireAccountId(req);
  } catch (r) {
    return r as Response;
  }
  const { id: contentHash } = await ctx.params;

  const rows = await db
    .select()
    .from(clips)
    .where(and(eq(clips.contentHash, contentHash), eq(clips.accountId, accountId)))
    .limit(1);
  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ clip: clipToDto(rows[0]) });
}

const attachConsentSchema = z.object({
  consentEventId: z.string().regex(/^evt_[0-9a-f-]{36}$/i),
}) satisfies z.ZodType<AttachClipConsentRequest>;

// PATCH /api/clips/:contentHash ─ Mentra がアップロード済みのクリップへ、
// 同じアカウントが iPhone で確認した同意イベントを後から結び付ける。
export async function PATCH(req: Request, ctx: Ctx) {
  let accountId: string;
  try {
    accountId = await requireAccountId(req);
  } catch (r) {
    return r as Response;
  }
  const { id: contentHash } = await ctx.params;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = attachConsentSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const clipRows = await db
    .select()
    .from(clips)
    .where(and(eq(clips.contentHash, contentHash), eq(clips.accountId, accountId)))
    .limit(1);
  if (clipRows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const clip = clipRows[0];
  if (clip.recordingConfig !== "mentra") {
    return NextResponse.json({ error: "Consent can only be attached after upload for Mentra clips" }, { status: 409 });
  }
  if (clip.consentEventId) {
    if (clip.consentEventId === parsed.data.consentEventId) {
      const body: AttachClipConsentResponse = { clip: clipToDto(clip) };
      return NextResponse.json(body);
    }
    return NextResponse.json({ error: "Consent is already attached" }, { status: 409 });
  }

  const eventRows = await db
    .select()
    .from(consentEvents)
    .where(and(
      eq(consentEvents.id, parsed.data.consentEventId),
      eq(consentEvents.accountId, accountId),
    ))
    .limit(1);
  if (eventRows.length === 0) {
    return NextResponse.json({ error: "Consent event not found" }, { status: 404 });
  }
  const event = eventRows[0];
  const context = event.context as Record<string, unknown> | null;
  if (
    !["consent", "reconsent"].includes(event.eventType)
    || context?.clipLocalId !== contentHash
    || context?.recordingConfig !== "mentra"
  ) {
    return NextResponse.json({ error: "Consent event does not match this clip" }, { status: 409 });
  }

  const [updated] = await db
    .update(clips)
    .set({ consentEventId: parsed.data.consentEventId })
    .where(and(
      eq(clips.contentHash, contentHash),
      eq(clips.accountId, accountId),
      isNull(clips.consentEventId),
    ))
    .returning();
  if (!updated) {
    return NextResponse.json({ error: "Consent was updated concurrently" }, { status: 409 });
  }

  const body: AttachClipConsentResponse = { clip: clipToDto(updated) };
  return NextResponse.json(body);
}

// DELETE /api/clips/:contentHash ─ 撮影者本人が raw と一覧行を破棄する。
// R2 を先に消し、成功後だけ DB 行を消す。R2 失敗時は行を残して再試行可能にする。
export async function DELETE(req: Request, ctx: Ctx) {
  let accountId: string;
  try {
    accountId = await requireAccountId(req);
  } catch (r) {
    return r as Response;
  }
  const { id: contentHash } = await ctx.params;

  const rows = await db
    .select()
    .from(clips)
    .where(and(eq(clips.contentHash, contentHash), eq(clips.accountId, accountId)))
    .limit(1);
  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const clip = rows[0];
  const recordingConfig = clip.recordingConfig as RecordingConfigId;
  if (!["ultra_wide", "arkit", "mentra", "iphone"].includes(recordingConfig)) {
    return NextResponse.json({ error: "Unsupported recording config" }, { status: 409 });
  }

  let deletedObjects: number;
  try {
    deletedObjects = await deleteRawSession(
      clip.contentHash,
      rawBucketFor(recordingConfig),
    );
  } catch (error) {
    console.error(`[DELETE /api/clips/${contentHash}] R2 deletion failed`, error);
    return NextResponse.json({ error: "Could not delete clip data" }, { status: 502 });
  }

  await db.delete(clips).where(and(
    eq(clips.contentHash, contentHash),
    eq(clips.accountId, accountId),
  ));

  const body: DeleteClipResponse = { ok: true, deletedObjects };
  return NextResponse.json(body);
}

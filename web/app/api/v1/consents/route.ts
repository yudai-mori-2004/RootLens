// POST /api/v1/consents — 同意イベントの記録 (= consent-log-spec の実装)。
//
// 端末はアップロード同意フォームの「同意して進む」 押下時に 1 イベントを送る。
// append-only: この route は INSERT のみ。 UPDATE / DELETE は提供しない
// (= 同意の有効性を後から立証する証跡。 撤回も event_type='withdrawal' の追記)。
//
// subject は body ではなく Bearer token の sub から取る (= 検証済み JWT のみを信用する)。

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { db } from "@/db/client";
import { consentEvents } from "@/db/schema";
import { requireAccountId } from "@/lib/auth";

const RequestSchema = z.object({
  eventType: z.enum(["consent", "reconsent", "withdrawal"]),
  /// 端末申告の同意時刻 (ISO 8601 UTC)
  occurredAt: z.string().datetime(),
  docSlug: z.enum(["tester-consent", "privacy-policy", "terms-of-service"]),
  docVersion: z.string().min(1).max(64),
  docContentHash: z.string().regex(/^[0-9a-f]{64}$/),
  summaryVersion: z.string().min(1).max(64),
  summaryHash: z.string().regex(/^[0-9a-f]{64}$/),
  scopes: z.array(z.enum(["collection", "ai_training_use", "license_sale", "cross_border"])).min(1),
  checkboxResults: z.record(z.string().max(64), z.boolean()),
  locale: z.enum(["ja", "en"]),
  consentMethod: z.literal("clickwrap"),
  appVersion: z.string().max(32).optional(),
  device: z.string().max(64).optional(),
  /// 相関情報 (= クリップ local id / 撮影時刻等)。 個人データは入れない。
  context: z.record(z.string().max(64), z.union([z.string().max(256), z.number()])).optional(),
});

export async function POST(req: NextRequest) {
  let accountId: string;
  try {
    accountId = await requireAccountId(req);
  } catch (r) {
    return r as Response;
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = RequestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const id = `evt_${randomUUID()}`;
  const [inserted] = await db
    .insert(consentEvents)
    .values({
      id,
      eventType: parsed.data.eventType,
      accountId,
      occurredAt: new Date(parsed.data.occurredAt),
      docSlug: parsed.data.docSlug,
      docVersion: parsed.data.docVersion,
      docContentHash: parsed.data.docContentHash,
      summaryVersion: parsed.data.summaryVersion,
      summaryHash: parsed.data.summaryHash,
      scopes: parsed.data.scopes,
      checkboxResults: parsed.data.checkboxResults,
      locale: parsed.data.locale,
      consentMethod: parsed.data.consentMethod,
      appVersion: parsed.data.appVersion ?? null,
      device: parsed.data.device ?? null,
      context: parsed.data.context ?? null,
    })
    .returning({ id: consentEvents.id, createdAt: consentEvents.createdAt });

  return NextResponse.json(
    { id: inserted.id, recordedAt: inserted.createdAt.toISOString() },
    { status: 201 },
  );
}

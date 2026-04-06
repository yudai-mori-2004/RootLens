/**
 * cNFT インデクサ 差分Pollエンドポイント
 *
 * Vercel Cron または手動呼び出しで実行。
 * desc順で最新から遡り、既知asset_idに当たったら打ち切り。
 */

import { NextResponse } from "next/server";
import { pollAll } from "@/lib/server/cnft-indexer";

// Vercel Cron の認証（CRON_SECRETが設定されている場合）
function verifyAuth(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // 未設定なら認証スキップ（dev環境）
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!verifyAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await pollAll();
    return NextResponse.json({
      ok: true,
      indexed: result,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[poll] error:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

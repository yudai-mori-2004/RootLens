/**
 * cNFT クエリエンドポイント
 *
 * content_hash で全cNFT（core + extensions）を返す。
 */

import { NextResponse } from "next/server";
import { queryByContentHash } from "@/lib/server/cnft-indexer";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ contentHash: string }> },
) {
  const { contentHash } = await params;
  if (!contentHash) {
    return NextResponse.json({ error: "contentHash required" }, { status: 400 });
  }

  try {
    const assets = await queryByContentHash(contentHash);
    return NextResponse.json({ assets });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

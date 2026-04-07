/**
 * POST /api/v1/publish
 *
 * パイプラインB: ページ生成 + cNFTインデクサ登録
 *
 * アプリ側で画像処理・R2アップロード・Title Protocol登録は完了済み。
 * サーバーはメタデータを受け取り、Supabaseにページレコードを作成する。
 * txSignatureがあれば、トランザクションからasset_idを抽出しインデクサに登録する。
 */

import { NextRequest, NextResponse } from "next/server";
import { createPage } from "@/lib/server/page-store";
import { indexFromTransaction } from "@/lib/server/cnft-indexer";

export async function POST(req: NextRequest) {
  try {
    const { contents, address } = await req.json();

    if (!Array.isArray(contents) || contents.length === 0) {
      return NextResponse.json(
        { error: "contents array is required" },
        { status: 400 },
      );
    }

    const first = contents[0];
    if (!first.contentHash || !first.thumbnailUrl) {
      return NextResponse.json(
        { error: "contentHash and thumbnailUrl are required" },
        { status: 400 },
      );
    }

    const record = await createPage({
      contentHash: first.contentHash,
      assetId: "",
      thumbnailUrl: first.thumbnailUrl,
      ogpImageUrl: first.ogpImageUrl || first.thumbnailUrl,
      address: address || undefined,
      mediaUrl: first.mediaUrl || "",
      mediaType: first.mediaType || "image",
      additionalContents: contents.slice(1).map((c: any) => ({
        contentHash: c.contentHash,
        assetId: "",
        thumbnailUrl: c.thumbnailUrl,
        ogpImageUrl: c.ogpImageUrl || c.thumbnailUrl,
        mediaUrl: c.mediaUrl || "",
        mediaType: c.mediaType || "image",
      })),
    });

    // cNFTインデクサ登録（txSignatureがあれば）
    const txSignatures = contents
      .map((c: any) => c.txSignature)
      .filter((s: any): s is string => !!s);

    const indexErrors: string[] = [];
    for (const sig of [...new Set(txSignatures)]) {
      try {
        const count = await indexFromTransaction(sig);
        console.log(`[publish] indexed ${count} assets from TX ${sig}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[publish] indexer failed:", msg);
        indexErrors.push(msg);
      }
    }

    const baseUrl = process.env.PUBLIC_PAGE_URL || "https://www.rootlens.io";
    const pageUrl = `${baseUrl}/p/${record.shortId}`;

    const response: Record<string, unknown> = {
      shortId: record.shortId,
      pageUrl,
      _debug: {
        txSignatureCount: txSignatures.length,
        txSignatures,
        indexErrors,
      },
    };

    if (indexErrors.length > 0) {
      return NextResponse.json(response, { status: 207 });
    }

    return NextResponse.json(response);
  } catch (e: unknown) {
    console.error("[publish] Error:", e);
    const msg = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

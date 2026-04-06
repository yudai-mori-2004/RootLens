/**
 * Helius Webhook 受信エンドポイント
 *
 * コレクションへのMintV2イベントをリアルタイムで受信し、
 * cNFTデータをインデックスする。
 */

import { NextResponse } from "next/server";
import { dasGetAsset, indexOneAsset } from "@/lib/server/cnft-indexer";

export async function POST(request: Request) {
  // Helius webhook 署名検証
  const authHeader = request.headers.get("authorization");
  const webhookSecret = process.env.HELIUS_WEBHOOK_SECRET;
  if (webhookSecret && authHeader !== webhookSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();

    // Helius webhook payload: 配列形式のトランザクション
    const transactions = Array.isArray(body) ? body : [body];
    let indexed = 0;

    for (const tx of transactions) {
      // Enhanced transaction format: tx.events.nft.mint に asset ID が含まれる
      // または tx.accountData から asset ID を抽出
      const assetIds = extractAssetIds(tx);

      for (const assetId of assetIds) {
        const asset = await dasGetAsset(assetId);
        if (!asset) continue;

        const ok = await indexOneAsset(asset);
        if (ok) indexed++;
      }
    }

    return NextResponse.json({ ok: true, indexed });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[webhook] error:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/**
 * Helius enhanced transaction からMintV2で生成されたasset IDを抽出する。
 * Bubblegum MintV2 のログから "Leaf asset ID: ..." を探す。
 */
function extractAssetIds(tx: any): string[] {
  const ids: string[] = [];

  // Method 1: Helius parsed NFT events
  if (tx.events?.nft) {
    const nftEvents = Array.isArray(tx.events.nft) ? tx.events.nft : [tx.events.nft];
    for (const evt of nftEvents) {
      if (evt.mint) ids.push(evt.mint);
    }
  }

  // Method 2: Log messages から Leaf asset ID を抽出
  const logs: string[] = tx.meta?.logMessages || tx.logMessages || [];
  for (const log of logs) {
    const match = log.match(/Leaf asset ID: (\w+)/);
    if (match) ids.push(match[1]);
  }

  // Method 3: Helius type=COMPRESSED_NFT_MINT
  if (tx.type === "COMPRESSED_NFT_MINT" && tx.assetId) {
    ids.push(tx.assetId);
  }

  return [...new Set(ids)]; // dedupe
}

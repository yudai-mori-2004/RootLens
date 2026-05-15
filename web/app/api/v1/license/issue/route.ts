// SPDX-License-Identifier: Apache-2.0
//
// POST /api/v1/license/issue — SPECS_JA §5.3
//
// (rootAssetId, licenseUrl, buyerAddress) → catalog で price 解決 → DAS で Root NFT
// proof 取得 → issue_license tx 組み立て → delegate で partial sign → base64 で返す。
// buyer 側で署名追加 + broadcast (settle はクライアント責務)。

import { Connection, PublicKey } from "@solana/web3.js";
import { NextRequest, NextResponse } from "next/server";
import { loadCatalogFromFile, lookup } from "@/lib/license-nft/catalog";
import { prepareIssueLicense } from "@/lib/license-nft/build-tx";
import { fetchRootNftProof } from "@/lib/license-nft/das";
import { envKeypairSigner } from "@/lib/license-nft/signer";

export const runtime = "nodejs";

interface RequestBody {
  rootAssetId?: unknown;
  licenseUrl?: unknown;
  buyerAddress?: unknown;
}

function bad(error: string, code: string, status = 400, detail?: string) {
  return NextResponse.json({ error, code, ...(detail ? { detail } : {}) }, { status });
}

let cachedConn: Connection | null = null;
let cachedCatalog: ReturnType<typeof loadCatalogFromFile> | null = null;

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env: ${name}`);
  return v;
}

function getConnection(): Connection {
  if (!cachedConn) {
    cachedConn = new Connection(getEnv("SOLANA_RPC_URL"), "confirmed");
  }
  return cachedConn;
}

function getCatalog() {
  if (cachedCatalog) return cachedCatalog;
  cachedCatalog = loadCatalogFromFile(getEnv("COSIGN_CATALOG_PATH"));
  return cachedCatalog;
}

// ----- handler ----------------------------------------------------------

export async function POST(req: NextRequest) {
  const reqId = crypto.randomUUID();
  const t0 = Date.now();
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    console.warn(`[license-issue ${reqId}] INVALID_INPUT (bad JSON)`);
    return bad("invalid JSON body", "INVALID_INPUT");
  }

  const rootAssetId = typeof body.rootAssetId === "string" ? body.rootAssetId : null;
  const licenseUrl = typeof body.licenseUrl === "string" ? body.licenseUrl : null;
  const buyerAddress = typeof body.buyerAddress === "string" ? body.buyerAddress : null;

  if (!rootAssetId || !licenseUrl || !buyerAddress) {
    console.warn(`[license-issue ${reqId}] INVALID_INPUT (missing fields)`);
    return bad(
      "rootAssetId, licenseUrl, buyerAddress are required",
      "INVALID_INPUT",
    );
  }

  console.info(`[license-issue ${reqId}] received rootAssetId=${rootAssetId} licenseUrl=${licenseUrl} buyer=${buyerAddress}`);

  // base58 形式の sanity check (PublicKey ctor が throw すれば無効)
  try {
    new PublicKey(rootAssetId);
    new PublicKey(buyerAddress);
  } catch {
    console.warn(`[license-issue ${reqId}] INVALID_INPUT (bad pubkey)`);
    return bad("rootAssetId / buyerAddress must be base58 pubkeys", "INVALID_INPUT");
  }

  // catalog lookup (本サーバの唯一の policy validation)
  let entry;
  try {
    const catalog = getCatalog();
    entry = lookup(catalog, rootAssetId, licenseUrl);
  } catch (e) {
    console.error(`[license-issue ${reqId}] INTERNAL_ERROR catalog load`, e);
    return bad("catalog load failed", "INTERNAL_ERROR", 500, (e as Error).message);
  }
  if (!entry) {
    console.warn(`[license-issue ${reqId}] NOT_LISTED rootAssetId=${rootAssetId} licenseUrl=${licenseUrl}`);
    return bad("(rootAssetId, licenseUrl) not in catalog", "NOT_LISTED", 404);
  }

  try {
    const rpcUrl = getEnv("SOLANA_RPC_URL");
    const result = await prepareIssueLicense({
      connection: getConnection(),
      fetchProof: (id) => fetchRootNftProof(rpcUrl, id),
      signer: envKeypairSigner("COSIGN_DELEGATE_PRIVATE_KEY_BASE58"),
      programId: new PublicKey(getEnv("LICENSE_NFT_PROGRAM_ID")),
      configPda: new PublicKey(getEnv("LICENSE_NFT_CONFIG_PDA")),
      licenseMerkleTree: new PublicKey(getEnv("LICENSE_MERKLE_TREE")),
      addressLookupTable: process.env.LICENSE_NFT_ALT
        ? new PublicKey(process.env.LICENSE_NFT_ALT)
        : undefined,
      rootAssetId,
      licenseUrl: entry.licenseUrl,
      buyerAddress,
      price: entry.price,
      licenseName: process.env.LICENSE_NAME ?? "RootLens License",
    });
    console.info(`[license-issue ${reqId}] OK price=${entry.price} elapsed=${Date.now() - t0}ms`);
    return NextResponse.json({ partialSignedTx: result.partialSignedTxBase64 });
  } catch (e) {
    const msg = (e as Error).message ?? "unknown";
    console.error(`[license-issue ${reqId}] build/sign error: ${msg}`);
    if (msg.includes("DAS")) {
      return bad("DAS lookup failed", "DAS_LOOKUP_FAILED", 502, msg);
    }
    return bad("internal error", "INTERNAL_ERROR", 500, msg);
  }
}

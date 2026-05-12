// SPDX-License-Identifier: Apache-2.0
//
// POST /api/license/co-sign
//
// SPECS_JA §5.3 の co-sign フロー。クライアント (AI 企業) から
// (rootAssetId, licenseUrl, buyerAddress) を受け取り、catalog にあれば
// issue_license tx を組み立てて delegate 署名を付与して返す。

import { Connection, PublicKey } from "@solana/web3.js";
import { NextRequest, NextResponse } from "next/server";
import { defaultCatalog, loadCatalogFromFile, lookup } from "@/lib/cosign/catalog";
import { buildAndSignIssueLicenseTx } from "@/lib/cosign/build-tx";
import { fetchAssetWithProof } from "@/lib/cosign/das";
import { envKeypairSigner } from "@/lib/cosign/signer";

export const runtime = "nodejs";

interface RequestBody {
  rootAssetId?: unknown;
  licenseUrl?: unknown;
  buyerAddress?: unknown;
}

function bad(error: string, code: string, status = 400, detail?: string) {
  return NextResponse.json({ error, code, ...(detail ? { detail } : {}) }, { status });
}

// ----- module-level singletons (cold start で 1 回だけ初期化) -------------

let cachedConn: Connection | null = null;
let cachedCatalogPath: string | null = null;
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
  // env が設定されていればそこから YAML を読む (dev / staging で外部編集したい時)。
  // 未設定なら bundle に焼かれた default catalog を使う (Vercel 等 env を渡せない環境向け)。
  const path = process.env.COSIGN_CATALOG_PATH;
  if (!path) {
    if (cachedCatalog && cachedCatalogPath === "::default::") return cachedCatalog;
    cachedCatalog = defaultCatalog();
    cachedCatalogPath = "::default::";
    return cachedCatalog;
  }
  if (cachedCatalog && cachedCatalogPath === path) return cachedCatalog;
  cachedCatalog = loadCatalogFromFile(path);
  cachedCatalogPath = path;
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
    console.warn(`[cosign ${reqId}] INVALID_INPUT (bad JSON)`);
    return bad("invalid JSON body", "INVALID_INPUT");
  }

  const rootAssetId = typeof body.rootAssetId === "string" ? body.rootAssetId : null;
  const licenseUrl = typeof body.licenseUrl === "string" ? body.licenseUrl : null;
  const buyerAddress = typeof body.buyerAddress === "string" ? body.buyerAddress : null;

  if (!rootAssetId || !licenseUrl || !buyerAddress) {
    console.warn(`[cosign ${reqId}] INVALID_INPUT (missing fields)`);
    return bad(
      "rootAssetId, licenseUrl, buyerAddress are required",
      "INVALID_INPUT",
    );
  }

  console.info(`[cosign ${reqId}] received rootAssetId=${rootAssetId} licenseUrl=${licenseUrl} buyer=${buyerAddress}`);

  // base58 形式の sanity check (PublicKey ctor が throw すれば無効)
  try {
    new PublicKey(rootAssetId);
    new PublicKey(buyerAddress);
  } catch {
    console.warn(`[cosign ${reqId}] INVALID_INPUT (bad pubkey)`);
    return bad("rootAssetId / buyerAddress must be base58 pubkeys", "INVALID_INPUT");
  }

  // catalog lookup (本サーバの唯一の policy validation)
  let entry;
  try {
    const catalog = getCatalog();
    entry = lookup(catalog, rootAssetId, licenseUrl);
  } catch (e) {
    console.error(`[cosign ${reqId}] INTERNAL_ERROR catalog load`, e);
    return bad("catalog load failed", "INTERNAL_ERROR", 500, (e as Error).message);
  }
  if (!entry) {
    console.warn(`[cosign ${reqId}] NOT_LISTED rootAssetId=${rootAssetId} licenseUrl=${licenseUrl}`);
    return bad("(rootAssetId, licenseUrl) not in catalog", "NOT_LISTED", 404);
  }

  // 構築 + sign
  try {
    // DAS API は Solana 公式 devnet RPC でも提供されているので、専用 env が無ければ
    // SOLANA_RPC_URL を流用する。dev/staging で別 DAS provider に切替えたい時のみ env 設定。
    const dasUrl = process.env.DAS_RPC_URL || getEnv("SOLANA_RPC_URL");
    const result = await buildAndSignIssueLicenseTx({
      connection: getConnection(),
      fetchProof: (id) => fetchAssetWithProof(dasUrl, id),
      signer: envKeypairSigner(getEnv("COSIGN_DELEGATE_PRIVATE_KEY_BASE58")),
      programId: new PublicKey(getEnv("LICENSE_NFT_PROGRAM_ID")),
      configPda: new PublicKey(getEnv("LICENSE_NFT_CONFIG_PDA")),
      licenseMerkleTree: new PublicKey(getEnv("LICENSE_MERKLE_TREE")),
      rootAssetId,
      licenseUrl: entry.licenseUrl,
      buyerAddress,
      price: entry.price,
      licenseName: process.env.LICENSE_NAME ?? "RootLens License",
    });
    console.info(`[cosign ${reqId}] OK price=${entry.price} elapsed=${Date.now() - t0}ms`);
    return NextResponse.json({ partialSignedTx: result.partialSignedTxBase64 });
  } catch (e) {
    const msg = (e as Error).message ?? "unknown";
    console.error(`[cosign ${reqId}] build/sign error: ${msg}`);
    if (msg.includes("DAS")) {
      return bad("DAS lookup failed", "DAS_LOOKUP_FAILED", 502, msg);
    }
    return bad("internal error", "INTERNAL_ERROR", 500, msg);
  }
}

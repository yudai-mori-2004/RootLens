// SPDX-License-Identifier: Apache-2.0
//
// E2E: ローカル web/ server の `POST /api/v1/license/issue` を叩いて、
// 帰ってきた partial-signed tx に buyer 署名を足して devnet で confirm する。
//
// 前提:
//   1. tests/license-nft/fixtures.json 存在 (license-nft の setup 済)
//   2. web/ dev server 起動中 (`cd web && npm run dev`)
//   3. app/.env に EXPO_PUBLIC_BUYER_KEYPAIR_BASE58 と EXPO_PUBLIC_LICENSE_USDC_MINT
//   4. keys/dev/solana/cosign-delegate.json + keys/deployer.json 存在
//
// 実行:
//   cd tests/staking && npx mocha --import tsx/esm --timeout 120000 03-api-license-issue.spec.ts

import { describe, it, before } from "mocha";
import { expect } from "chai";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import bs58 from "bs58";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  mintTo,
} from "@solana/spl-token";

import {
  buildDelegateV2Ix,
  fetchRootNftProof,
  findLeafAssetId,
  getConnection,
  getDasUrl,
  loadKeypair,
  loadKeypairFromFile,
  sendIx,
  waitUntilDelegate,
} from "./helpers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "../..");

const SERVER_URL =
  process.env.LICENSE_ISSUE_URL ?? "http://localhost:3000/api/v1/license/issue";

const COMMERCIAL_LICENSE_URL =
  "https://rootlens.io/licenses/commercial-v1/0000000000000000000000000000000000000000000000000000000000000000.json";

const PRICE_USDC = 1_000_000n; // catalog wildcard で 1 USDC

interface LicenseFixtures {
  program_id: string;
  config_pda: string;
  root_nft_collection: string;
  license_collection: string;
  usdc_mint: string;
  root_tree: string;
  leaves: Array<{
    name: string;
    index: number;
    owner: string;
    owner_secret: number[];
    delegate: string;
  }>;
}

function loadLicenseFixtures(): LicenseFixtures {
  const p = resolve(REPO_ROOT, "tests/license-nft/fixtures.json");
  return JSON.parse(readFileSync(p, "utf-8")) as LicenseFixtures;
}

/** app/.env を最小限 parse (dotenv 入れたくない) */
function loadAppEnv(): Record<string, string> {
  const text = readFileSync(resolve(REPO_ROOT, "app/.env"), "utf-8");
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1).replace(/^"(.*)"$/, "$1");
  }
  return out;
}

function loadCosignDelegatePubkey(): PublicKey {
  const p = resolve(REPO_ROOT, "keys/dev/solana/cosign-delegate.json");
  const arr = JSON.parse(readFileSync(p, "utf-8")) as number[];
  return Keypair.fromSecretKey(new Uint8Array(arr)).publicKey;
}

async function ensureAtaExists(
  conn: Connection,
  payer: Keypair,
  mint: PublicKey,
  owner: PublicKey,
  allowOffCurve = false,
): Promise<PublicKey> {
  const ata = getAssociatedTokenAddressSync(mint, owner, allowOffCurve);
  const info = await conn.getAccountInfo(ata);
  if (info) return ata;
  const ix = createAssociatedTokenAccountInstruction(payer.publicKey, ata, owner, mint);
  await sendAndConfirmTransaction(conn, new Transaction().add(ix), [payer], {
    commitment: "confirmed",
  });
  return ata;
}

describe("E2E: POST /api/v1/license/issue (local server → devnet)", function () {
  let conn: Connection;
  let dasUrl: string;
  let fixtures: LicenseFixtures;
  let buyerKp: Keypair;
  let usdcMint: PublicKey;
  let cosignDelegate: PublicKey;
  let deployer: Keypair;

  before(async function () {
    this.timeout(30000);
    conn = getConnection();
    dasUrl = getDasUrl();
    fixtures = loadLicenseFixtures();

    const appEnv = loadAppEnv();
    const buyerB58 = appEnv.EXPO_PUBLIC_BUYER_KEYPAIR_BASE58;
    if (!buyerB58) throw new Error("EXPO_PUBLIC_BUYER_KEYPAIR_BASE58 missing in app/.env");
    buyerKp = Keypair.fromSecretKey(bs58.decode(buyerB58));
    usdcMint = new PublicKey(fixtures.usdc_mint);
    cosignDelegate = loadCosignDelegatePubkey();
    deployer = loadKeypairFromFile("deployer.json");

    console.log(`\n=== E2E env ===`);
    console.log(`  server URL:       ${SERVER_URL}`);
    console.log(`  buyer:            ${buyerKp.publicKey.toBase58()}`);
    console.log(`  USDC mint:        ${usdcMint.toBase58()}`);
    console.log(`  cosign delegate:  ${cosignDelegate.toBase58()}`);
    console.log(`  root tree:        ${fixtures.root_tree}`);

    // server health check (404 でも reachable なら OK = HTTP 応答が返ってきてる)
    try {
      const r = await fetch(SERVER_URL, { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });
      console.log(`  server ping → ${r.status} (${r.status === 400 ? "OK (expected INVALID_INPUT)" : "unexpected"})`);
      if (r.status === 404) {
        throw new Error(`server returned 404 for ${SERVER_URL} — endpoint not deployed? start with: cd web && npm run dev`);
      }
    } catch (e) {
      throw new Error(`server at ${SERVER_URL} not reachable: ${(e as Error).message}`);
    }
  });

  it("staked leaf_4 で buyer が license を購入できる", async function () {
    this.timeout(120000);

    // ---- 1. fixtures から leaf_4 ----
    const leaf = fixtures.leaves.find((l) => l.name === "leaf_4");
    if (!leaf) throw new Error("leaf_4 not found");
    const owner = loadKeypair(leaf.owner_secret);
    const rootTree = new PublicKey(fixtures.root_tree);
    const assetId = findLeafAssetId(rootTree, leaf.index);
    console.log(`\n[1] leaf_4 asset_id: ${assetId.toBase58()}`);
    console.log(`    leaf_4 owner:    ${owner.publicKey.toBase58()}`);

    // ---- 2. owner の SOL 補充 (delegateV2 の payer になる) ----
    const ownerBal = await conn.getBalance(owner.publicKey);
    if (ownerBal < 10_000_000) {
      console.log(`[2] owner SOL 残高 ${ownerBal} → deployer から 0.02 SOL fund`);
      await sendAndConfirmTransaction(
        conn,
        new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: deployer.publicKey,
            toPubkey: owner.publicKey,
            lamports: 20_000_000,
          }),
        ),
        [deployer],
        { commitment: "confirmed" },
      );
    } else {
      console.log(`[2] owner SOL OK (${ownerBal})`);
    }

    // ---- 3. stake (delegateV2 で leaf.delegate = cosign-delegate) ----
    const current = await fetchRootNftProof(assetId, dasUrl);
    if (current.leafDelegate.equals(cosignDelegate)) {
      console.log(`[3] 既に staked to cosign-delegate, skip`);
    } else {
      console.log(`[3] stake: ${current.leafDelegate.toBase58().slice(0, 8)}.. → ${cosignDelegate.toBase58().slice(0, 8)}..`);
      const ix = buildDelegateV2Ix({
        payer: owner.publicKey,
        leafOwner: owner.publicKey,
        newLeafDelegate: cosignDelegate,
        asset: current,
      });
      await sendIx(conn, [ix], [owner]);
      await waitUntilDelegate(assetId, cosignDelegate, dasUrl, { timeoutMs: 60000 });
      console.log(`    stake confirmed`);
    }

    // ---- 4. ATA ensure (delegate + pool + buyer) ----
    const configPda = new PublicKey(fixtures.config_pda);
    console.log(`[4] ensure ATAs`);
    await ensureAtaExists(conn, deployer, usdcMint, cosignDelegate);
    await ensureAtaExists(conn, deployer, usdcMint, configPda, /*allowOffCurve*/ true);
    const buyerUsdcAta = await ensureAtaExists(conn, deployer, usdcMint, buyerKp.publicKey);

    // ---- 5. buyer USDC mint (1 USDC * 2 で余裕持たせる) ----
    const bAccBefore = await getAccount(conn, buyerUsdcAta);
    if (bAccBefore.amount < PRICE_USDC) {
      const mintAmount = Number(PRICE_USDC * 2n);
      console.log(`[5] buyer USDC balance ${bAccBefore.amount} → mint ${mintAmount}`);
      await mintTo(conn, deployer, usdcMint, buyerUsdcAta, deployer, mintAmount);
    } else {
      console.log(`[5] buyer USDC OK (${bAccBefore.amount})`);
    }

    const balBefore = {
      buyer: (await getAccount(conn, buyerUsdcAta)).amount,
      delegate: (await getAccount(conn, getAssociatedTokenAddressSync(usdcMint, cosignDelegate))).amount,
      pool: (await getAccount(conn, getAssociatedTokenAddressSync(usdcMint, configPda, true))).amount,
    };

    // ---- 6. POST /api/v1/license/issue ----
    console.log(`\n[6] POST ${SERVER_URL}`);
    const res = await fetch(SERVER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rootAssetId: assetId.toBase58(),
        licenseUrl: COMMERCIAL_LICENSE_URL,
        buyerAddress: buyerKp.publicKey.toBase58(),
      }),
    });
    console.log(`    status: ${res.status}`);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`server returned ${res.status}: ${text}`);
    }
    const body = (await res.json()) as { partialSignedTx: string };
    expect(body.partialSignedTx).to.be.a("string");
    console.log(`    partialSignedTx: ${body.partialSignedTx.length} chars base64`);

    // ---- 7. buyer 署名追加 + broadcast ----
    const tx = VersionedTransaction.deserialize(Buffer.from(body.partialSignedTx, "base64"));
    tx.sign([buyerKp]);
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
    console.log(`\n[7] broadcast sig: ${sig}`);
    console.log(`    https://solscan.io/tx/${sig}?cluster=devnet`);

    const conf = await conn.confirmTransaction(sig, "confirmed");
    if (conf.value.err) {
      throw new Error(`tx failed on-chain: ${JSON.stringify(conf.value.err)}`);
    }
    console.log(`    confirmed`);

    // ---- 8. USDC 95:5 検証 ----
    const balAfter = {
      buyer: (await getAccount(conn, buyerUsdcAta)).amount,
      delegate: (await getAccount(conn, getAssociatedTokenAddressSync(usdcMint, cosignDelegate))).amount,
      pool: (await getAccount(conn, getAssociatedTokenAddressSync(usdcMint, configPda, true))).amount,
    };

    console.log(`\n[8] USDC 残高 (delta = after - before)`);
    console.log(`    buyer:    ${balBefore.buyer} → ${balAfter.buyer} (Δ ${Number(balAfter.buyer) - Number(balBefore.buyer)})`);
    console.log(`    delegate: ${balBefore.delegate} → ${balAfter.delegate} (Δ ${Number(balAfter.delegate) - Number(balBefore.delegate)})`);
    console.log(`    pool:     ${balBefore.pool} → ${balAfter.pool} (Δ ${Number(balAfter.pool) - Number(balBefore.pool)})`);

    // on-chain Config から実際の BPS を読んで期待値を計算する (= update_config で BPS を
     // 変えても test が壊れない)
    const cfgInfo = await conn.getAccountInfo(configPda, "confirmed");
    if (!cfgInfo) throw new Error("config PDA not found");
    const stakerBps = cfgInfo.data.readUInt16LE(8 + 32 * 4);
    const delegateBps = cfgInfo.data.readUInt16LE(8 + 32 * 4 + 2);
    const expectedDelegate = (Number(PRICE_USDC) * delegateBps) / 10000;
    const expectedPool = (Number(PRICE_USDC) * stakerBps) / 10000;
    console.log(`    expected split: staker ${stakerBps}bps / delegate ${delegateBps}bps`);

    expect(Number(balBefore.buyer) - Number(balAfter.buyer)).to.equal(Number(PRICE_USDC));
    expect(Number(balAfter.delegate) - Number(balBefore.delegate)).to.equal(expectedDelegate);
    expect(Number(balAfter.pool) - Number(balBefore.pool)).to.equal(expectedPool);
  });
});

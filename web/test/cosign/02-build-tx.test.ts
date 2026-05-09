// SPDX-License-Identifier: Apache-2.0
//
// build-tx 統合テスト。Connection と DAS は mock。実 Solana には繋がない。

import { describe, it, expect } from "vitest";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { buildAndSignIssueLicenseTx, getAssociatedTokenAddress } from "@/lib/cosign/build-tx";
import { decodeIssueLicenseIxData, anchorDiscriminator, findUserRevenuePda } from "@/lib/cosign/program";
import { makeMockEnv } from "./helpers";

const LICENSE_URL = "https://rootlens.io/licenses/commercial-v1/abc.json";
const LICENSE_NAME = "RootLens License — commercial-v1";

describe("build-tx", () => {
  it("builds issue_license tx with delegate signature attached, buyer slot empty", async () => {
    const env = makeMockEnv();
    const result = await buildAndSignIssueLicenseTx({
      connection: env.connection,
      fetchProof: env.fetchProof,
      signer: env.signer,
      programId: env.programId,
      configPda: env.configPda,
      licenseMerkleTree: env.licenseMerkleTree,
      rootAssetId: "AnyAssetId",
      licenseUrl: LICENSE_URL,
      buyerAddress: env.buyerKp.publicKey.toBase58(),
      price: 1_000_000n,
      licenseName: LICENSE_NAME,
    });

    const tx = VersionedTransaction.deserialize(Buffer.from(result.partialSignedTxBase64, "base64"));

    // 静的アカウント先頭は fee_payer = buyer
    const staticKeys = tx.message.staticAccountKeys;
    expect(staticKeys[0].toBase58()).toBe(env.buyerKp.publicKey.toBase58());

    // 署名スロット: buyer (0) と delegate (1) が signers
    const numSigners = tx.message.header.numRequiredSignatures;
    expect(numSigners).toBe(2);

    // delegate は signed (sig 全 0 ではない)、buyer は未署名 (sig 全 0)
    const buyerIdx = staticKeys.findIndex((k) => k.equals(env.buyerKp.publicKey));
    const delegateIdx = staticKeys.findIndex((k) => k.equals(env.delegateKp.publicKey));
    expect(buyerIdx).toBeGreaterThanOrEqual(0);
    expect(delegateIdx).toBeGreaterThanOrEqual(0);
    const buyerSig = tx.signatures[buyerIdx];
    const delegateSig = tx.signatures[delegateIdx];
    expect(buyerSig.every((b) => b === 0)).toBe(true);
    expect(delegateSig.some((b) => b !== 0)).toBe(true);
  });

  it("encoded IX args match input price + URI + name", async () => {
    const env = makeMockEnv();
    const PRICE = 4_242_000n;
    const result = await buildAndSignIssueLicenseTx({
      connection: env.connection,
      fetchProof: env.fetchProof,
      signer: env.signer,
      programId: env.programId,
      configPda: env.configPda,
      licenseMerkleTree: env.licenseMerkleTree,
      rootAssetId: "AnyAssetId",
      licenseUrl: LICENSE_URL,
      buyerAddress: env.buyerKp.publicKey.toBase58(),
      price: PRICE,
      licenseName: LICENSE_NAME,
    });

    const tx = VersionedTransaction.deserialize(Buffer.from(result.partialSignedTxBase64, "base64"));
    expect(tx.message.compiledInstructions.length).toBe(1);
    const ix = tx.message.compiledInstructions[0];
    const decoded = decodeIssueLicenseIxData(Buffer.from(ix.data));

    // discriminator
    expect(decoded.discriminator.equals(anchorDiscriminator("issue_license"))).toBe(true);
    // args
    expect(decoded.licenseMetadataUri).toBe(LICENSE_URL);
    expect(decoded.licenseName).toBe(LICENSE_NAME);
    expect(decoded.price).toBe(PRICE);
    expect(decoded.nonce).toBe(7n);
    expect(decoded.index).toBe(7);
    expect(decoded.flags).toBe(0);
    // proof bytes
    expect(decoded.dataHash.equals(Buffer.alloc(32, 2))).toBe(true);
    expect(decoded.creatorHash.equals(Buffer.alloc(32, 3))).toBe(true);
    expect(decoded.root.equals(Buffer.alloc(32, 1))).toBe(true);
    // root_collection は config の title_core_collection
    expect(decoded.rootCollection.toBase58()).toBe(env.rootCollection.toBase58());
  });

  it("IX accounts: staker = leaf.owner, user_revenue PDA, ATAs derived correctly", async () => {
    const env = makeMockEnv();
    const result = await buildAndSignIssueLicenseTx({
      connection: env.connection,
      fetchProof: env.fetchProof,
      signer: env.signer,
      programId: env.programId,
      configPda: env.configPda,
      licenseMerkleTree: env.licenseMerkleTree,
      rootAssetId: "AnyAssetId",
      licenseUrl: LICENSE_URL,
      buyerAddress: env.buyerKp.publicKey.toBase58(),
      price: 1n,
      licenseName: LICENSE_NAME,
    });

    const tx = VersionedTransaction.deserialize(Buffer.from(result.partialSignedTxBase64, "base64"));
    const staticKeys = tx.message.staticAccountKeys;
    const ix = tx.message.compiledInstructions[0];
    const ixKeys = Array.from(ix.accountKeyIndexes).map((idx) => staticKeys[idx]);

    // accounts 順序は buildIssueLicenseIx と一致するはず:
    // [0] buyer, [1] delegate, [2] staker, [3] config, [4] userRevenue, [5] usdcMint,
    // [6] buyerUsdc, [7] delegateUsdc, [8] poolUsdc, [9] rootMerkleTree,
    // [10] licenseMerkleTree, ...
    expect(ixKeys[0].toBase58()).toBe(env.buyerKp.publicKey.toBase58());
    expect(ixKeys[1].toBase58()).toBe(env.delegateKp.publicKey.toBase58());
    expect(ixKeys[2].toBase58()).toBe(env.stakerKp.publicKey.toBase58()); // = leaf.owner
    expect(ixKeys[3].toBase58()).toBe(env.configPda.toBase58());
    expect(ixKeys[4].toBase58()).toBe(findUserRevenuePda(env.programId, env.stakerKp.publicKey).toBase58());
    expect(ixKeys[5].toBase58()).toBe(env.usdcMint.toBase58());
    expect(ixKeys[6].toBase58()).toBe(getAssociatedTokenAddress(env.usdcMint, env.buyerKp.publicKey).toBase58());
    expect(ixKeys[7].toBase58()).toBe(getAssociatedTokenAddress(env.usdcMint, env.delegateKp.publicKey).toBase58());
    expect(ixKeys[8].toBase58()).toBe(getAssociatedTokenAddress(env.usdcMint, env.configPda, true).toBase58());
    expect(ixKeys[9].toBase58()).toBe(env.rootMerkleTree.toBase58());
    expect(ixKeys[10].toBase58()).toBe(env.licenseMerkleTree.toBase58());

    // proof accounts は末尾 (signer/sysvar の後)
    const proofKeys = ixKeys.slice(-2);
    expect(proofKeys.length).toBe(2);
    proofKeys.forEach((k) => expect(k).toBeInstanceOf(PublicKey));
  });

  it("throws if config PDA not found on chain", async () => {
    const env = makeMockEnv();
    (env.connection.getAccountInfo as ReturnType<typeof import("vitest").vi.fn>)
      .mockResolvedValueOnce(null);
    await expect(
      buildAndSignIssueLicenseTx({
        connection: env.connection,
        fetchProof: env.fetchProof,
        signer: env.signer,
        programId: env.programId,
        configPda: env.configPda,
        licenseMerkleTree: env.licenseMerkleTree,
        rootAssetId: "AnyAssetId",
        licenseUrl: LICENSE_URL,
        buyerAddress: env.buyerKp.publicKey.toBase58(),
        price: 1n,
        licenseName: LICENSE_NAME,
      }),
    ).rejects.toThrow(/config PDA not found/);
  });

  it("getAssociatedTokenAddress refuses off-curve owner unless explicitly allowed", () => {
    // configPda は確実に off-curve (PDA)
    const env = makeMockEnv();
    expect(() => getAssociatedTokenAddress(env.usdcMint, env.configPda)).toThrow(/off-curve/);
    // allowOwnerOffCurve=true で OK
    const ata = getAssociatedTokenAddress(env.usdcMint, env.configPda, true);
    expect(ata).toBeInstanceOf(PublicKey);
  });
});

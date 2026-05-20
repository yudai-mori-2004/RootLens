import { eq } from "drizzle-orm";
import { FatalError } from "workflow";
import { db } from "@/db/client";
import { clips } from "@/db/schema";
import { callBlur } from "@/lib/modal";
import { computeQuality, type QualityBreakdown } from "@/lib/quality";
import { submitToTp } from "@/lib/tp";
import { rawMp4Key, blurredMp4Key } from "@/lib/r2-keys";
import type { ProcessingStep } from "@/shared/api-types";

// SPECS_JA §6.2 Pipeline 2 (品質評価) を Vercel Workflow DevKit で実装する。
//
// 入力: 端末から R2 にアップロードされた 生 MP4 1 個 + 並走 sensor stream。
// 流れ:
//   1. anonymize     Modal で ぼかし MP4 生成 + サーバ C2PA 署名 (= 「署名 S」)
//   2. quality-eval  sensors.jsonl から品質スコア算出
//   3. tp-submit     TitleClient.register で Root NFT 発行
//   4. ready         DB 更新
//
// 端末 C2PA 署名 (= 段階 2) は今後の追加。 該当 step は導入時に再度追加する。
//
// Pipeline 3 (= LeRobot dataset 整形) は本 workflow に含まない。 ライセンス販売
// イベントなど Pipeline 2 と独立した契機で `callBundle` を呼ぶ。
//
// WDK の規約:
//   - `"use workflow"` ディレクティブを付けた関数が orchestration
//   - `"use step"` ディレクティブを付けた関数が durable な処理単位
//   - step は自動 retry、 idempotency、 サーバ再起動を跨いだ resume が言語レベルで担保される

interface ProcessClipInput {
  clipId: string;
}

// ─── orchestration ───────────────────────────────────────────────────

export async function processClip(input: ProcessClipInput) {
  "use workflow";

  const clip = await loadClip(input.clipId);
  if (!clip.contentHash || !clip.rawMp4Key) {
    throw new FatalError(`Clip ${input.clipId} missing contentHash / rawMp4Key`);
  }

  // ステップ 1: 匿名化 + サーバ派生 C2PA 署名 (= Modal が一括で実施)
  await setStep(input.clipId, "anonymize");
  const blur = await runBlur({
    clipId: input.clipId,
    contentHash: clip.contentHash,
    inputKey: rawMp4Key(clip.contentHash),
    outputKey: blurredMp4Key(clip.contentHash),
  });

  // ステップ 2: 品質評価
  await setStep(input.clipId, "quality-eval");
  const quality = await evalQuality({
    clipId: input.clipId,
    contentHash: clip.contentHash,
  });

  // ステップ 3: TP submission + Root NFT 発行
  await setStep(input.clipId, "tp-submit");
  const tp = await callTp({
    clipId: input.clipId,
    blurredR2Key: blurredMp4Key(clip.contentHash),
    blurredContentHash: blur.blurredContentHash,
    ownerWalletPubkey: clip.walletPubkey,
    idempotencyKey: blur.blurredContentHash,
  });

  // ステップ 4: 「準備完了」 へ遷移
  await markReady({
    clipId: input.clipId,
    rootAssetId: tp.rootAssetId,
    qualityScore: quality.total,
    qualityBreakdown: quality.breakdown,
    blurredMp4Key: blurredMp4Key(clip.contentHash),
  });
}

// ─── steps (= 永続化される処理単位、 自動 retry) ────────────────────

async function loadClip(clipId: string) {
  "use step";
  const rows = await db.select().from(clips).where(eq(clips.id, clipId)).limit(1);
  if (rows.length === 0) throw new FatalError(`Clip ${clipId} not found`);
  return rows[0];
}

async function setStep(clipId: string, step: ProcessingStep) {
  "use step";
  await db.update(clips)
    .set({ processingStep: step, updatedAt: new Date() })
    .where(eq(clips.id, clipId));
}

async function runBlur(args: {
  clipId: string;
  contentHash: string;
  inputKey: string;
  outputKey: string;
}) {
  "use step";
  return await callBlur({
    inputKey: args.inputKey,
    outputKey: args.outputKey,
    idempotencyKey: args.contentHash,
  });
}

async function evalQuality(args: { clipId: string; contentHash: string }) {
  "use step";
  return await computeQuality({ contentHash: args.contentHash });
}

async function callTp(args: {
  clipId: string;
  blurredR2Key: string;
  blurredContentHash: string;
  ownerWalletPubkey: string;
  idempotencyKey: string;
}) {
  "use step";
  const tosVersion = process.env.ROOTLENS_TOS_VERSION;
  const tosHash = process.env.ROOTLENS_TOS_HASH;
  if (!tosVersion || !tosHash) {
    // ToS の同意検証は Root NFT 発行の legal chain の根拠 (= SPECS_JA §4.4.2)。
    // env 未設定で進めると placeholder ハッシュが焼き込まれて検証不能になるので fail-loud。
    throw new Error(
      "ROOTLENS_TOS_VERSION and ROOTLENS_TOS_HASH must both be set before TP submission.",
    );
  }
  return await submitToTp({
    blurredR2Key: args.blurredR2Key,
    blurredContentHash: args.blurredContentHash,
    ownerWalletPubkey: args.ownerWalletPubkey,
    rootlensLicenseInput: { tosVersion, tosHash },
    idempotencyKey: args.idempotencyKey,
  });
}

async function markReady(args: {
  clipId: string;
  rootAssetId: string;
  qualityScore: number;
  qualityBreakdown: QualityBreakdown;
  blurredMp4Key: string;
}) {
  "use step";
  await db.update(clips)
    .set({
      state: "ready",
      processingStep: null,
      rootAssetId: args.rootAssetId,
      qualityScore: args.qualityScore,
      qualityBreakdown: {
        anyHandRatio: args.qualityBreakdown.anyHandRatio,
        twoHandRatio: args.qualityBreakdown.twoHandRatio,
        depthValidRatio: args.qualityBreakdown.depthValidRatio,
        syncRatio: args.qualityBreakdown.syncRatio,
        frameGapCount: args.qualityBreakdown.frameGapCount,
      },
      blurredMp4Key: args.blurredMp4Key,
      updatedAt: new Date(),
    })
    .where(eq(clips.id, args.clipId));

  // Push 通知は持っていない。 端末は 2 秒 polling で ready を拾う (= clipPipeline.startHttpPolling)。
}

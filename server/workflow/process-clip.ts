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
//   1. c2pa-verify   端末署名の事前検証 (= 段階 2 のみ、 MVP は no-op)
//   2. anonymize     Modal で ぼかし MP4 生成 + サーバ C2PA 署名 (= 「署名 S」)
//   3. quality-eval  ぼかし MP4 から品質スコア算出
//   4. tp-submit     TitleClient.register で Root NFT 発行
//   5. ready         DB 更新 + 撮影者通知
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

  // ステップ 1: 端末 C2PA 事前検証 (= MVP は no-op、 段階 2 で実装)
  await setStep(input.clipId, "c2pa-verify");
  await verifyDeviceC2pa({ clipId: input.clipId, rawMp4Key: clip.rawMp4Key });

  // ステップ 2: 匿名化 + サーバ派生 C2PA 署名 (= Modal が一括で実施)
  await setStep(input.clipId, "anonymize");
  const blur = await runBlur({
    clipId: input.clipId,
    contentHash: clip.contentHash,
    inputKey: rawMp4Key(clip.contentHash),
    outputKey: blurredMp4Key(clip.contentHash),
  });

  // ステップ 3: 品質評価
  await setStep(input.clipId, "quality-eval");
  const quality = await evalQuality({
    clipId: input.clipId,
    blurredKey: blurredMp4Key(clip.contentHash),
  });

  // ステップ 4: TP submission + Root NFT 発行
  await setStep(input.clipId, "tp-submit");
  const tp = await callTp({
    clipId: input.clipId,
    blurredR2Key: blurredMp4Key(clip.contentHash),
    blurredContentHash: blur.blurredContentHash,
    ownerWalletPubkey: clip.walletPubkey,
    idempotencyKey: blur.blurredContentHash,
  });

  // ステップ 5: 「準備完了」 へ遷移
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

async function verifyDeviceC2pa(_args: { clipId: string; rawMp4Key: string }) {
  "use step";
  // MVP: 端末 C2PA 署名 (= 段階 2) は未実装、 ここは no-op。
  // 段階 2 が動き始めたら c2pa-rs (= node binding) で MP4 manifest を verify し、
  // 不正なら FatalError を throw して workflow 中断。
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

async function evalQuality(args: { clipId: string; blurredKey: string }) {
  "use step";
  return await computeQuality({ blurredR2Key: args.blurredKey });
}

async function callTp(args: {
  clipId: string;
  blurredR2Key: string;
  blurredContentHash: string;
  ownerWalletPubkey: string;
  idempotencyKey: string;
}) {
  "use step";
  return await submitToTp({
    blurredR2Key: args.blurredR2Key,
    blurredContentHash: args.blurredContentHash,
    ownerWalletPubkey: args.ownerWalletPubkey,
    rootlensLicenseInput: {
      tosVersion: process.env.ROOTLENS_TOS_VERSION ?? "v1.0.0",
      tosHash: process.env.ROOTLENS_TOS_HASH ?? "",
    },
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

  // TODO: Expo Push 通知発火
}

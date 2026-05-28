import { eq } from "drizzle-orm";
import { FatalError } from "workflow";
import { db } from "@/db/client";
import { clips } from "@/db/schema";
import {
  callMetadataScore,
  callFrameSampling,
  callVlmScore,
  type VlmScoreResult,
} from "@/lib/modal";
import type {
  ProcessingStep,
  Layer1Score,
  Layer2Score,
  QualityBreakdown,
} from "@/shared/api-types";

// Pipeline 2 (= 品質スコアリング 3 層 + 自動分類) を Vercel Workflow DevKit で実装する (DATA_SPECS §3)。
//
// VLM (= Layer 3) は映像から自律的にカテゴリを分類し、 autoCategory / autoCategoryConfidence /
// frameLabels を返す。 autoCategory / autoCategoryConfidence は DB 列追加までログにのみ出す
// (= mapper は列が無い間は null を返す)。
//
// 入力: 端末が raw/<signature_hash>/ にアップロードしたファイル (= rgb.mp4 は D2 署名済 + 顔ぼかし済)。
// 流れ:
//   1. metadata-scan    第 1 層 (= realtime_handpose.jsonl から手検出率等で 20 点)
//   2. frame-sampling   第 2 層 (= フレームサンプル画像解析で 15 点)
//   3. vlm-score        第 3 層 (= Claude Haiku 4.5 で 65 点 + 自動分類)
//   4. ready 遷移       DB 更新
//
// processed/<signature_hash>/ への semantic.jsonl / quality_scores.json 書き出しは Modal 側が行う
// (= WDK worker は R2 を直接叩かない設計)。 ここは Modal 呼び出しの orchestration + DB 更新に専念する。
//
// 各 step は durable: 自動 retry、 冪等性、 サーバ再起動を跨いだ resume が WDK で担保される。

interface ProcessClipInput {
  clipId: string;
}

// ─── orchestration ───────────────────────────────────────────────────

export async function processClip(input: ProcessClipInput) {
  "use workflow";

  const clip = await loadClip(input.clipId);
  if (!clip.signatureHash || !clip.signedMp4Key) {
    throw new FatalError(`Clip ${input.clipId} missing signatureHash / signedMp4Key`);
  }
  if (!clip.rootAssetId) {
    // v0.1.3: Pipeline 2 開始の前提条件 = rootAssetId 確定済 (= Pipeline 1 末尾 cNFT 発行で確定)。
    // 通常 finalize endpoint で先に弾かれるが、 防御として workflow 自体でも fail-loud。
    throw new FatalError(`Clip ${input.clipId} missing rootAssetId (Pipeline 1 incomplete)`);
  }

  // ステップ 1: 第 1 層 (= メタデータ解析)
  await setStep(input.clipId, "metadata-scan");
  const layer1 = await runLayer1({
    clipId: input.clipId,
    signatureHash: clip.signatureHash,
  });

  // ステップ 2: 第 2 層 (= フレームサンプリング画像解析)
  await setStep(input.clipId, "frame-sampling");
  const layer2 = await runLayer2({
    clipId: input.clipId,
    signatureHash: clip.signatureHash,
  });

  // ステップ 3: 第 3 層 (= VLM セマンティック解析 + 自動分類、 65 点)
  await setStep(input.clipId, "vlm-score");
  const layer3 = await runLayer3({
    clipId: input.clipId,
    signatureHash: clip.signatureHash,
  });

  // ステップ 4: ready 遷移
  await markReady({
    clipId: input.clipId,
    layer1,
    layer2,
    layer3,
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
  await db
    .update(clips)
    .set({ processingStep: step, updatedAt: new Date() })
    .where(eq(clips.id, clipId));
}

async function runLayer1(args: { clipId: string; signatureHash: string }): Promise<Layer1Score> {
  "use step";
  return await callMetadataScore({ signatureHash: args.signatureHash });
}

async function runLayer2(args: { clipId: string; signatureHash: string }): Promise<Layer2Score> {
  "use step";
  return await callFrameSampling({ signatureHash: args.signatureHash });
}

async function runLayer3(args: {
  clipId: string;
  signatureHash: string;
}): Promise<VlmScoreResult> {
  "use step";
  return await callVlmScore({ signatureHash: args.signatureHash });
}

async function markReady(args: {
  clipId: string;
  layer1: Layer1Score;
  layer2: Layer2Score;
  layer3: VlmScoreResult;
}) {
  "use step";
  // 3 層合計 (= 20 + 15 + 65 = 100 上限、 DATA_SPECS §3.2.4)
  const total = args.layer1.score + args.layer2.score + args.layer3.score;
  const breakdown: QualityBreakdown = {
    total,
    layer1: args.layer1,
    layer2: args.layer2,
    layer3: args.layer3,
  };

  // autoCategory / autoCategoryConfidence は DB 列が追加されるまでログのみ。
  // mapper.ts は列が無ければ null を返す形なので client にも null として届く。
  console.log(
    `[process-clip] ready ${args.clipId} score=${total}/100 ` +
    `category=${args.layer3.autoCategory} (${args.layer3.autoCategoryConfidence.toFixed(2)}) ` +
    `frameLabels=${args.layer3.frameLabels.length}`,
  );

  await db
    .update(clips)
    .set({
      state: "ready",
      processingStep: null,
      qualityScore: total,
      qualityBreakdown: breakdown,
      idleRatio: args.layer3.idleRatio.toFixed(4),
      updatedAt: new Date(),
    })
    .where(eq(clips.id, args.clipId));

  // rootAssetId / signedJsonUri / processedPrefix は Pipeline 1 (端末) が POST /api/clips 時に
  // 確定させているので、 ここでは触らない。
  // 端末への push 通知は task 別途。 現状は client が 2 秒 polling で ready を拾う。
}

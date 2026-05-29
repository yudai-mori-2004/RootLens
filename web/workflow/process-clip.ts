import { eq } from "drizzle-orm";
import { FatalError } from "workflow";
import { db } from "@/db/client";
import { clips } from "@/db/schema";
import { callLayer3Labeling, type Layer3LabelResult } from "@/lib/modal";
import type { ProcessingStep } from "@/shared/api-types";

// Pipeline 2 (= dense narration ラベリング) を Vercel Workflow DevKit で実装する (DATA_SPECS §3)。
//
// ⚠ 品質スコアリングはこのフローから分離した。 スコアリングはタスク定義に依存する別概念であり、
//    ラベル (semantic.jsonl) を入力にした別レイヤーで後段に被せる設計 (= 現状未実装)。
//    したがって現状の Pipeline 2 はラベリング専任: クリップ → dense narration → ready。
//
// 入力: 端末が raw/<signature_hash>/ にアップロードしたファイル (= rgb.mp4 は D2 署名済 + 顔ぼかし済)。
// 流れ: labeling (= Modal layer3, gemini-video-dense 既定) → ready 遷移。
// processed/<signature_hash>/semantic.jsonl の書き出しは Modal 側が行う (= WDK worker は R2 を直接叩かない)。
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
    throw new FatalError(`Clip ${input.clipId} missing rootAssetId (Pipeline 1 incomplete)`);
  }

  // ラベリング (= dense narration、 採点はしない)
  await setStep(input.clipId, "labeling");
  const labeling = await runLabeling({
    clipId: input.clipId,
    signatureHash: clip.signatureHash,
  });

  // ready 遷移
  await markReady({ clipId: input.clipId, labeling });
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

async function runLabeling(args: { clipId: string; signatureHash: string }): Promise<Layer3LabelResult> {
  "use step";
  // dense narration (= gemini-video-dense 既定)。 採点はしない (= スコアリングは別レイヤー)。
  return await callLayer3Labeling({ signatureHash: args.signatureHash });
}

async function markReady(args: { clipId: string; labeling: Layer3LabelResult }) {
  "use step";
  // 品質スコアは付けない (= スコアリングは別レイヤーで後段)。 ラベリング由来の観測
  // (autoCategory / idleRatio) のみ記録して ready に遷移する。
  console.log(
    `[process-clip] ready ${args.clipId} (labeling only) ` +
    `category=${args.labeling.autoCategory} (${args.labeling.autoCategoryConfidence.toFixed(2)}) ` +
    `segments=${args.labeling.frameLabels.length}`,
  );

  await db
    .update(clips)
    .set({
      state: "ready",
      processingStep: null,
      idleRatio: args.labeling.idleRatio.toFixed(4),
      updatedAt: new Date(),
    })
    .where(eq(clips.id, args.clipId));

  // rootAssetId / signedJsonUri / processedPrefix は Pipeline 1 (端末) が POST /api/clips 時に
  // 確定させているので、 ここでは触らない。
}

import { eq } from "drizzle-orm";
import { FatalError } from "workflow";
import { db } from "@/db/client";
import { clips } from "@/db/schema";
import {
  callMetadataScore,
  callFrameSampling,
  callVlmScore,
  callGtsam,
} from "@/lib/modal";
import type {
  ProcessingStep,
  Layer1Score,
  Layer2Score,
  Layer3Score,
  GtsamScore,
  QualityBreakdown,
} from "@/shared/api-types";

// Pipeline 2 (= 品質スコアリング 4 層) を Vercel Workflow DevKit で実装する。
//
// 入力: 端末が R2 にアップロードした 4 ファイル (= rgb.mp4 が D2 署名済 + 顔ぼかし済)。
// 流れ:
//   1. metadata-scan    第 1 層 (= sensors.jsonl + imu_high_rate.jsonl で 20 点)
//   2. frame-sampling   第 2 層 (= フレームサンプル画像解析で 15 点)
//   3. vlm-score        第 3 層 (= Claude Haiku 4.5 で 55 点)
//   4. gtsam-eval       Video-IMU 整合性 (= 10 点) + 画面再撮影攻撃検出
//   5. ready 遷移       DB 更新
//
// Title Protocol register はサーバ flow に載せず、 端末 (= mock-device) が R2 アップロード
// 後に並列で /process Gateway を叩く構造になった。 rootAssetId / signedJsonUri は別経路で
// DB に反映される。
//
// 各 step は durable: 自動 retry、 冪等性、 サーバ再起動を跨いだ resume が WDK で担保される。

interface ProcessClipInput {
  clipId: string;
}

// ─── orchestration ───────────────────────────────────────────────────

export async function processClip(input: ProcessClipInput) {
  "use workflow";

  const clip = await loadClip(input.clipId);
  if (!clip.contentId || !clip.signedMp4Key) {
    throw new FatalError(`Clip ${input.clipId} missing contentId / signedMp4Key`);
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
    contentId: clip.contentId,
  });

  // ステップ 2: 第 2 層 (= フレームサンプリング画像解析)
  await setStep(input.clipId, "frame-sampling");
  const layer2 = await runLayer2({
    clipId: input.clipId,
    contentId: clip.contentId,
  });

  // ステップ 3: 第 3 層 (= VLM セマンティック解析)
  await setStep(input.clipId, "vlm-score");
  const layer3 = await runLayer3({
    clipId: input.clipId,
    contentId: clip.contentId,
    taskId: clip.taskId,
  });

  // ステップ 4: GTSAM Video-IMU 整合性
  await setStep(input.clipId, "gtsam-eval");
  const gtsam = await runGtsam({
    clipId: input.clipId,
    contentId: clip.contentId,
  });

  // ステップ 5: ready 遷移
  await markReady({
    clipId: input.clipId,
    layer1,
    layer2,
    layer3,
    gtsam,
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

async function runLayer1(args: { clipId: string; contentId: string }): Promise<Layer1Score> {
  "use step";
  return await callMetadataScore({ contentId: args.contentId });
}

async function runLayer2(args: { clipId: string; contentId: string }): Promise<Layer2Score> {
  "use step";
  return await callFrameSampling({ contentId: args.contentId });
}

async function runLayer3(args: {
  clipId: string;
  contentId: string;
  taskId: string;
}): Promise<Layer3Score> {
  "use step";
  return await callVlmScore({ contentId: args.contentId, taskId: args.taskId });
}

async function runGtsam(args: { clipId: string; contentId: string }): Promise<GtsamScore> {
  "use step";
  return await callGtsam({ contentId: args.contentId });
}

async function markReady(args: {
  clipId: string;
  layer1: Layer1Score;
  layer2: Layer2Score;
  layer3: Layer3Score;
  gtsam: GtsamScore;
}) {
  "use step";
  const total = args.layer1.score + args.layer2.score + args.layer3.score + args.gtsam.score;
  const breakdown: QualityBreakdown = {
    total,
    layer1: args.layer1,
    layer2: args.layer2,
    layer3: args.layer3,
    gtsam: args.gtsam,
  };

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

  // rootAssetId / signedJsonUri / datasetPrefix は別経路 (= mock-device の並列 TP register flow
  // 経由で後段 endpoint から更新) なので、 ここでは触らない。
  // 端末への push 通知は task 別途。 現状は client が 2 秒 polling で ready を拾う。
}

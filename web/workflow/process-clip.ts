import { eq } from "drizzle-orm";
import { FatalError } from "workflow";
import { db } from "@/db/client";
import { clips } from "@/db/schema";
import { callPipeline2, type Pipeline2Result } from "@/lib/modal";
import type { ProcessingStep, QualityVector } from "@/shared/api-types";

// Pipeline 2 (= 前処理ラベリング + 多軸採点) を Vercel Workflow DevKit で実装する (DATA_SPECS §3)。
//
// Pipeline 2 のゴールは品質の定量化 (= 採点)。 ラベリング等はその前準備。 Modal の rootlens-pipeline2
// が対称な2ステージ (preprocess → scoring) を stateless に実行し、 軸ごと 0-100 の品質ベクトル
// (= 合計なし) を返す。 ここはその呼び出し + DB 更新に専念する (= R2 書き出しは Modal 側)。
//
// ⚠ 合成スコア (= 重み付け合算) は持たない。 軸ベクトルをそのまま保存し、 重み付けは買い手が行う。
//
// 各 step は durable: 自動 retry、 冪等性、 サーバ再起動を跨いだ resume が WDK で担保される。

interface ProcessClipInput {
  clipId: string;
}

// ─── orchestration ───────────────────────────────────────────────────

export async function processClip(input: ProcessClipInput) {
  "use workflow";

  const clip = await loadClip(input.clipId);
  if (!clip.signatureHash) {
    // raw key (raw/<sig>/rgb.mp4) は signature_hash から導出する。
    throw new FatalError(`Clip ${input.clipId} missing signatureHash`);
  }
  if (!clip.rootAssetId) {
    // v0.1.3: Pipeline 2 開始の前提条件 = rootAssetId 確定済 (= Pipeline 1 末尾 cNFT 発行で確定)。
    throw new FatalError(`Clip ${input.clipId} missing rootAssetId (Pipeline 1 incomplete)`);
  }

  await setStep(input.clipId, "scoring");
  const result = await runPipeline2({ clipId: input.clipId, signatureHash: clip.signatureHash });
  await markReady({ clipId: input.clipId, result });
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

async function runPipeline2(args: { clipId: string; signatureHash: string }): Promise<Pipeline2Result> {
  "use step";
  // 既定の preprocess (= labeling) + 採点軸 (= video_technical / motion_content / label_quality)。
  return await callPipeline2({ signatureHash: args.signatureHash });
}

async function markReady(args: { clipId: string; result: Pipeline2Result }) {
  "use step";
  // 軸ベクトル (= 合計なし) をそのまま quality_vector 列に保存。 合成スコアは持たない。
  const vector: QualityVector = { axes: args.result.scores };

  // labeling 前処理の meta から summary (= Gemini 全体パスの 1 行要約) と duration (= cv2 probe、 秒) を拾う。
  // DATA_SPECS §3.4: semantic.jsonl ヘッダの summary / duration と同源。 DB に非正規化して可読ラベル + 録画尺にする。
  const labelMeta = args.result.preprocessed.find((p) => p.name === "labeling")?.meta ?? {};
  const summary = typeof labelMeta.summary === "string" ? labelMeta.summary : null;
  const durationSec = typeof labelMeta.duration === "number" ? labelMeta.duration : null;
  const durationMs = durationSec !== null ? Math.round(durationSec * 1000) : null;

  console.log(
    `[process-clip] ready ${args.clipId} axes=` +
    Object.entries(args.result.scores).map(([k, v]) => `${k}:${v.score}`).join(" "),
  );

  // summary / durationMs は取れた時だけ更新 (= 端末申告 duration を上書きしない)。
  const patch: Partial<typeof clips.$inferInsert> = {
    state: "ready",
    processingStep: null,
    qualityVector: vector,
    updatedAt: new Date(),
  };
  if (summary !== null) patch.summary = summary;
  if (durationMs !== null) patch.durationMs = durationMs;

  await db.update(clips).set(patch).where(eq(clips.id, args.clipId));
}

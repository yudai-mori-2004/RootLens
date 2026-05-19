import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

// rootlens-server: クライアントからの clip upload + サーバパイプライン (= ぼかし、 派生 C2PA 署名、
// 品質評価、 TP submission、 MCAP 合成、 R2 配置) + ステーキング API を提供する
// Next.js (App Router) サーバ。
//
// SPECS_JA §2.7 のクリップ状態機械と §6.2 のサーバパイプラインを実装する。
//
// withWorkflow:
//   "use workflow" / "use step" ディレクティブを SWC で transform し、
//   workflow package が start(fn) で fn を「workflow function」 として認識できるようにする。
//   wrap しないと start で 「invalid workflow function」 が出る。

const nextConfig: NextConfig = {};

export default withWorkflow(nextConfig);

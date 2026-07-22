import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import SiteLayout from "../../components/shared/SiteLayout";
import SampleViewer from "../../components/lp/sample/SampleViewer";
import type { PipelineOption } from "../../components/lp/sample/types";

// rootlens-public バケットの公開 URL prefix。 このドメインの直下に lp-sample/<slug>/ が並ぶ。
// 将来カスタムドメイン (例: assets.rootlens.io) に載せ替える場合は 1 箇所書き換えれば足りる。
const R2_PUBLIC = "https://pub-494b37dbfc9645299042fcf51236d1fc.r2.dev";

function assetsFor(slug: string, opts: { hasLidar: boolean }) {
  const base = `${R2_PUBLIC}/lp-sample/${slug}`;
  return {
    slug,
    rgb: `${base}/rgb.mp4`,
    depth: opts.hasLidar ? `${base}/depth.mp4` : null,
    mesh: opts.hasLidar ? `${base}/mesh.glb` : null,
    trajectory: `${base}/trajectory.json`,
    timeseries: `${base}/timeseries.json`,
    summary: `${base}/summary.json`,
  };
}

// パイプライン (収録スタック) 別の表示定義。 arkit がデフォルト、 mentra は準備中プレースホルダー。
// 「デバイス名」 ではなく 「収録パイプライン名」 で軸を揃える (Mentra Live は mentra、 iPhone Pro は arkit)。
// スタックが増えたらここに 1 項目足すだけ。
function buildPipelines(locale: "ja" | "en"): PipelineOption[] {
  const arkit: PipelineOption = {
    id: "arkit",
    label: locale === "ja" ? "iPhone (LiDAR あり)" : "iPhone (LiDAR)",
    description: locale === "ja"
      ? "LiDAR 付きの iPhone(15 Pro 以降)で撮影しました。映像に加えて、部屋の奥行き・カメラの位置と向き・加速度・手の動き・空間の 3D メッシュを、すべて同じ時刻に揃えて記録しています。"
      : "Recorded on iPhone 15 Pro or newer with LiDAR. Video, depth, camera pose, IMU, hand tracking, and a room mesh — all aligned on a single timeline.",
    available: true,
    assets: assetsFor("arkit-home-01", { hasLidar: true }),
  };
  const mentra: PipelineOption = {
    id: "mentra",
    label: locale === "ja" ? "スマートグラス (Mentra Live)" : "Smart glasses (Mentra Live)",
    description: locale === "ja"
      ? "スマートグラスの Mentra Live で撮影します。記録できるのは映像と加速度で、LiDAR の奥行き情報や 3D メッシュはありません。現場での本収録を準備中です。"
      : "Captured with the Mentra Live smart glasses. Video and IMU only — no LiDAR depth or mesh. On-site recording is in preparation.",
    available: false,
  };
  return [arkit, mentra];
}

export const metadata: Metadata = {
  title: "RootLens Sample Dataset",
  description: "RGB, LiDAR depth, 3D scene with trajectory, and sensor readouts — one clip, four synchronized panels.",
};

export default async function Page() {
  const locale = await getLocale();
  const loc: "ja" | "en" = locale === "ja" ? "ja" : "en";
  const pipelines = buildPipelines(loc);

  return (
    <SiteLayout>
      <SampleViewer pipelines={pipelines} />
    </SiteLayout>
  );
}

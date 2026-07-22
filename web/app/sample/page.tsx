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
    label: locale === "ja" ? "arkit パイプライン" : "arkit pipeline",
    description: locale === "ja"
      ? "iPhone 15 Pro 以降の LiDAR 搭載機に、 Apple の ARKit を土台にした収録スタック。 RGB / LiDAR 深度 / 6DoF 姿勢 / IMU / ハンドトラック / メッシュを同じ時計で吐き出す。"
      : "Apple's ARKit-based capture stack running on iPhone 15 Pro or newer (with LiDAR). Delivers RGB, LiDAR depth, 6DoF pose, IMU, hand tracking, and reconstructed mesh on a single shared clock.",
    available: true,
    assets: assetsFor("arkit-home-01", { hasLidar: true }),
  };
  const mentra: PipelineOption = {
    id: "mentra",
    label: locale === "ja" ? "mentra パイプライン" : "mentra pipeline",
    description: locale === "ja"
      ? "Mentra Live を代表とする MentraOS 系スマートグラスの収録スタック。 RGB + IMU が主。 家事とパン工房での本収録を準備中。"
      : "MentraOS-based smart-glasses capture stack (Mentra Live). Delivers RGB and IMU. In-shop capture is in preparation.",
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

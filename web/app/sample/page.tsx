import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
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
// スタックが増えたらここに 1 項目足すだけで、 表示文字列は messages/*.json 側で管理する。
async function buildPipelines(): Promise<PipelineOption[]> {
  const t = await getTranslations("pages.sample.pipelines");
  return [
    {
      id: "arkit",
      label: t("arkit.label"),
      description: t("arkit.description"),
      available: true,
      assets: assetsFor("arkit-home-01", { hasLidar: true }),
    },
    {
      id: "mentra",
      label: t("mentra.label"),
      description: t("mentra.description"),
      available: false,
    },
  ];
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pages.sample.meta");
  return { title: t("title"), description: t("description") };
}

export default async function Page() {
  const pipelines = await buildPipelines();
  return (
    <SiteLayout>
      <SampleViewer pipelines={pipelines} />
    </SiteLayout>
  );
}

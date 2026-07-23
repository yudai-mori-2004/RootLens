import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import SiteLayout from "../../components/shared/SiteLayout";
import SampleViewer from "../../components/lp/sample/SampleViewer";
import type { PipelineOption } from "../../components/lp/sample/types";

// rootlens-public バケットの公開 URL prefix。 このドメインの直下に lp-sample/<hash8>/ が並ぶ。
// 将来カスタムドメイン (例: assets.rootlens.io) に載せ替える場合は 1 箇所書き換えれば足りる。
const R2_PUBLIC = "https://pub-494b37dbfc9645299042fcf51236d1fc.r2.dev";

// サンプルデータの正は共有ドライブの samples/ フォルダ。 このページはその中の各セッションを
// ブラウザで再生できる形に変換したキャッシュ (lp-sample/<hash8>/) を読んでいるだけ。
const DRIVE_SAMPLES_URL = "https://drive.google.com/drive/folders/13ej8wsVq3LdC99pT21mIPj5nv50mkeJM";

// arkit パイプラインで切替表示するセッション (= ドライブ samples/<domain>/arkit/ の全フォルダ)。
// stamp と driveId はドライブの実フォルダと 1:1。 先頭が初期表示。
const ARKIT_SESSIONS = [
  { hash8: "24aa0d6f", domain: "bakery", stamp: "2026-07-20_1440", driveId: "1tUahNWo_dg9_QHYWDDTg9REK5kUUQrjB" },
  { hash8: "66be33ca", domain: "bakery", stamp: "2026-07-21_1451", driveId: "1APgSN7EAzJqehH2KwTLIaF82x8gp5iSK" },
  { hash8: "3fd59dfa", domain: "bakery", stamp: "2026-07-21_1534", driveId: "1wMgQaeScWNx17zM1tmkEpOMz3Ast_97b" },
  { hash8: "9726042b", domain: "home", stamp: "2026-07-08_0427", driveId: "1oiBvpZOWEnS10JQqLhn5fUW8ybXU4dnD" },
  { hash8: "4b467914", domain: "home", stamp: "2026-07-10_1744", driveId: "17Y2owARuPy8M10XnhQvoMdj_Gj3wraF1" },
  { hash8: "85327fd1", domain: "home", stamp: "2026-07-10_1755", driveId: "1S_DHiM0a-cMbkYhz3zeAO9Z37DDFlxZf" },
] as const;

// "2026-07-20_1440" → "7/20 14:40" (ドライブのフォルダ名と同じ UTC 表記を短縮しただけ)
function stampLabel(stamp: string): string {
  const [date, hm] = stamp.split("_");
  const [, m, d] = date.split("-");
  return `${Number(m)}/${Number(d)} ${hm.slice(0, 2)}:${hm.slice(2)}`;
}

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
  const td = await getTranslations("pages.sample.domains");
  const sessions = ARKIT_SESSIONS.map((s) => ({
    id: s.hash8,
    domainLabel: td(s.domain),
    when: stampLabel(s.stamp),
    assets: assetsFor(s.hash8, { hasLidar: true }),
    drive: {
      path: `samples/${s.domain}/arkit/${s.stamp}_${s.hash8}`,
      url: `https://drive.google.com/drive/folders/${s.driveId}`,
    },
  }));
  return [
    {
      id: "arkit",
      label: t("arkit.label"),
      description: t("arkit.description"),
      available: true,
      sessions,
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
      <SampleViewer pipelines={pipelines} driveUrl={DRIVE_SAMPLES_URL} />
    </SiteLayout>
  );
}

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

// LP ビューアで見せるセッション (= ドライブ samples/ の中から見せ方を決めた 1 本)。
// range は LP 上で再生を許す時間窓: 店内が広く映る区間を避け、 見せたい作業だけに絞る。
// UI 側の制限のみで、 データ本体 (ドライブの rgb / mcap) は全編のまま。
// stamp は録画開始時刻 (UTC)。 stamp と driveId はドライブの実フォルダと 1:1。
const ARKIT_SESSIONS = [
  {
    hash8: "24aa0d6f", domain: "bakery", stamp: "2026-07-18_0441",
    driveId: "1tUahNWo_dg9_QHYWDDTg9REK5kUUQrjB",
    range: { startSec: 14 * 60 + 49, endSec: 23 * 60 + 50 },
  },
] as const;

// "2026-07-18_0441" → "7/18 04:41" (ドライブのフォルダ名と同じ録画開始時刻 UTC の短縮表記)
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
    range: s.range,
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

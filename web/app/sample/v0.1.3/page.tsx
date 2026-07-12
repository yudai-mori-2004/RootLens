import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import SiteLayout from "../../../components/shared/SiteLayout";
import s from "../../../components/lp/lp.module.css";

const ZIP_URL =
  "https://pub-494b37dbfc9645299042fcf51236d1fc.r2.dev/lp-sample/v0.1.3/rootlens-sample-5h-2026-06-20.zip";

export const metadata: Metadata = {
  title: "RootLens Sample v0.1.3",
  description:
    "47 egocentric housework clips, approximately 5 hours, with WiLoR 3D hand pose.",
};

const CONTENT = {
  ja: {
    subtitle:
      "一人称視点の家事クリップ47本、約5時間。撮影者3名・4世帯。WiLoR 3Dハンドポーズと端末上の2Dハンドランドマークを同梱。顔はぼかし処理済み。",
    download: "ダウンロード (26 GB)",
    insideTitle: "同梱内容",
    insideLead: "各クリップのディレクトリには次のファイルが入っています。",
    files: [
      ["rgb.mp4", "顔ぼかし済み映像、1920×1080、30fps、HEVC。"],
      ["handpose.jsonl", "WiLoR-mini 3Dハンドポーズ (MANO表現)、両手、全フレーム。"],
      ["realtime_handpose.jsonl", "撮影時に端末上で取得した2Dハンドランドマーク (Apple Vision)。"],
      ["metadata.json", "端末・OS・撮影設定。"],
    ],
    readme:
      "形式の詳細とクリップごとの統計は、ZIP内の README.md と manifest.json を参照してください。",
    licenseTitle: "ライセンス",
    licenseBody:
      "評価目的での利用に限ります。商用利用・再配布・派生物の作成など、受領者の内部評価を超える利用には、RootLensとの別途ライセンス契約が必要です。",
  },
  en: {
    subtitle:
      "47 egocentric housework clips, approximately 5 hours, 3 recorders, 4 households. Includes WiLoR 3D hand pose and on-device 2D hand landmarks. Faces blurred.",
    download: "Download (26 GB)",
    insideTitle: "What's inside",
    insideLead: "Each clip directory contains:",
    files: [
      ["rgb.mp4", "face-blurred video, 1920×1080, 30fps, HEVC."],
      ["handpose.jsonl", "WiLoR-mini 3D hand pose (MANO representation), both hands, all frames."],
      ["realtime_handpose.jsonl", "on-device 2D hand landmarks captured during recording (Apple Vision)."],
      ["metadata.json", "device, OS, capture config."],
    ],
    readme:
      "See README.md and manifest.json inside the ZIP for the full format and per-clip statistics.",
    licenseTitle: "License",
    licenseBody:
      "Evaluation use only. Commercial use, redistribution, derivative works, or any use beyond internal evaluation by the recipient require a separate license agreement with RootLens.",
  },
} as const;

export default async function Page() {
  const locale = await getLocale();
  const c = CONTENT[locale === "ja" ? "ja" : "en"];

  return (
    <SiteLayout>
      <div className={s.page}>
        <section className={s.datasetHero}>
          <div className={s.datasetHeroInner}>
            <h2 className={s.datasetTitle}>RootLens Sample v0.1.3</h2>
            <p className={s.datasetSubtitle}>{c.subtitle}</p>
            <a href={ZIP_URL} download className={s.ctaPrimary}>
              {c.download}
            </a>
          </div>
        </section>

        <section className={s.section}>
          <div className={s.sectionInner}>
            <h3 className={s.sectionTitle}>{c.insideTitle}</h3>
            <p className={s.prose}>{c.insideLead}</p>
            <ul className={s.bulletList}>
              {c.files.map(([name, desc]) => (
                <li key={name} className={s.bulletItem}>
                  <code>{name}</code> – {desc}
                </li>
              ))}
            </ul>
            <p className={s.prose}>{c.readme}</p>
          </div>
        </section>

        <section className={s.section}>
          <div className={s.sectionInner}>
            <h3 className={s.sectionTitle}>{c.licenseTitle}</h3>
            <p className={s.prose}>{c.licenseBody}</p>
          </div>
        </section>
      </div>
    </SiteLayout>
  );
}

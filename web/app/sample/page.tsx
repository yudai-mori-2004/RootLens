import type { Metadata } from "next";
import Link from "next/link";
import { getLocale } from "next-intl/server";
import SiteLayout from "../../components/shared/SiteLayout";
import s from "../../components/lp/lp.module.css";

export const metadata: Metadata = {
  title: "RootLens Sample Datasets",
  description: "Public sample datasets from RootLens.",
};

const CONTENT = {
  ja: {
    title: "サンプルデータ",
    intro: "RootLensが公開しているサンプルデータセットです。バージョンごとに内容が独立しているので、各ページで詳細を確認してダウンロードしてください。",
    samples: [
      {
        href: "/sample/v0.1.3",
        title: "Sample v0.1.3",
        summary:
          "一人称視点の家事クリップ47本、約5時間、26 GB。生の映像にWiLoR 3Dハンドポーズと端末上の2Dハンドランドマークを同梱。",
      },
      {
        href: "/sample/v0.1",
        title: "Sample v0.1",
        summary:
          "一人称視点の家事動画48本、約1 GB。LeRobotDataset v3.0形式で、フレームごとの3Dハンドポーズと行動ラベル付き。",
      },
    ],
  },
  en: {
    title: "Sample Datasets",
    intro: "Public sample datasets from RootLens. Each version is independently scoped; open one for details and download.",
    samples: [
      {
        href: "/sample/v0.1.3",
        title: "Sample v0.1.3",
        summary:
          "47 egocentric housework clips, approximately 5 hours, 26 GB. Raw videos with WiLoR 3D hand pose and on-device 2D hand landmarks.",
      },
      {
        href: "/sample/v0.1",
        title: "Sample v0.1",
        summary:
          "48 first-person housework clips, approximately 1 GB. LeRobotDataset v3.0 format with per-frame 3D hand pose and action labels.",
      },
    ],
  },
} as const;

export default async function Page() {
  const locale = await getLocale();
  const c = CONTENT[locale === "ja" ? "ja" : "en"];

  return (
    <SiteLayout>
      <div className={s.page}>
        <section className={s.section}>
          <div className={s.sectionInner}>
            <h1 className={s.sectionTitle}>{c.title}</h1>
            <p className={s.prose}>{c.intro}</p>
          </div>
        </section>

        <section className={s.section}>
          <div className={s.sectionInner}>
            <ul className={s.bulletList}>
              {c.samples.map((item) => (
                <li key={item.href} className={s.bulletItem}>
                  <Link href={item.href}>
                    <strong>{item.title}</strong>
                  </Link>{" "}
                  – {item.summary}
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </SiteLayout>
  );
}

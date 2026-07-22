import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import SiteLayout from "../../components/shared/SiteLayout";
import s from "../../components/lp/lp.module.css";

export const metadata: Metadata = {
  title: "RootLens Sample Dataset",
  description: "Public sample dataset from RootLens.",
};

const CONTENT = {
  ja: {
    title: "サンプルデータ",
    body: "新しいショーケースページを準備中です。RGB / LiDAR 深度 / 3D 空間・軌跡 / センサ数値を、同じ 1 クリップから 4 パネルで同期表示する予定です。",
  },
  en: {
    title: "Sample data",
    body: "A new showcase page is in preparation. It will present a single clip through four synchronized panels: RGB, LiDAR depth, 3D scene with trajectory, and sensor readouts.",
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
            <p className={s.prose}>{c.body}</p>
          </div>
        </section>
      </div>
    </SiteLayout>
  );
}

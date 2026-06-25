import type { Metadata } from "next";
import Link from "next/link";
import SiteLayout from "../../components/shared/SiteLayout";
import s from "../../components/lp/lp.module.css";

export const metadata: Metadata = {
  title: "RootLens Sample Datasets",
  description: "Public sample datasets from RootLens.",
};

const SAMPLES = [
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
      "22 episodes, approximately 1 GB. LeRobotDataset v3 format with phase labels and skeleton overlays.",
  },
];

export default function Page() {
  return (
    <SiteLayout>
      <div className={s.page}>
        <section className={s.section}>
          <div className={s.sectionInner}>
            <h1 className={s.sectionTitle}>Sample Datasets</h1>
            <p className={s.prose}>
              Public sample datasets from RootLens. Each version is independently scoped; open one for details and download.
            </p>
          </div>
        </section>

        <section className={s.section}>
          <div className={s.sectionInner}>
            <ul className={s.bulletList}>
              {SAMPLES.map((item) => (
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

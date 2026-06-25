import type { Metadata } from "next";
import SiteLayout from "../../../components/shared/SiteLayout";
import s from "../../../components/lp/lp.module.css";

const ZIP_URL =
  "https://pub-494b37dbfc9645299042fcf51236d1fc.r2.dev/lp-sample/v0.1.3/rootlens-sample-5h-2026-06-20.zip";

export const metadata: Metadata = {
  title: "RootLens Sample v0.1.3",
  description:
    "47 egocentric housework clips, approximately 5 hours, with WiLoR 3D hand pose.",
};

export default function Page() {
  return (
    <SiteLayout>
      <div className={s.page}>
        <section className={s.datasetHero}>
          <div className={s.datasetHeroInner}>
            <h2 className={s.datasetTitle}>RootLens Sample v0.1.3</h2>
            <p className={s.datasetSubtitle}>
              47 egocentric housework clips, approximately 5 hours, 3 recorders, 4 households.
              Includes WiLoR 3D hand pose and on-device 2D hand landmarks. Faces blurred.
            </p>
            <a href={ZIP_URL} download className={s.ctaPrimary}>
              Download (26 GB)
            </a>
          </div>
        </section>

        <section className={s.section}>
          <div className={s.sectionInner}>
            <h3 className={s.sectionTitle}>What&apos;s inside</h3>
            <p className={s.prose}>Each clip directory contains:</p>
            <ul className={s.bulletList}>
              <li className={s.bulletItem}>
                <code>rgb.mp4</code> – face-blurred video, 1920×1080, 30fps, HEVC.
              </li>
              <li className={s.bulletItem}>
                <code>handpose.jsonl</code> – WiLoR-mini 3D hand pose (MANO representation), both hands, all frames.
              </li>
              <li className={s.bulletItem}>
                <code>realtime_handpose.jsonl</code> – on-device 2D hand landmarks captured during recording (Apple Vision).
              </li>
              <li className={s.bulletItem}>
                <code>metadata.json</code> – device, OS, capture config.
              </li>
            </ul>
            <p className={s.prose}>
              See <code>README.md</code> and <code>manifest.json</code> inside the ZIP for the full format and per-clip statistics.
            </p>
          </div>
        </section>

        <section className={s.section}>
          <div className={s.sectionInner}>
            <h3 className={s.sectionTitle}>License</h3>
            <p className={s.prose}>
              Evaluation use only. Commercial use, redistribution, derivative works, or any use beyond internal evaluation by the recipient require a separate license agreement with RootLens.
            </p>
          </div>
        </section>
      </div>
    </SiteLayout>
  );
}

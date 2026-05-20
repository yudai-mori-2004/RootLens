import { getTranslations } from "next-intl/server";
import s from "./lp.module.css";

const R2_PUBLIC = "https://pub-494b37dbfc9645299042fcf51236d1fc.r2.dev/lp-sample/v0.1";

const PREVIEW_EPISODES = [
  { ep: 0, captionKey: "previewEp0Caption" },
  { ep: 7, captionKey: "previewEp7Caption" },
  { ep: 21, captionKey: "previewEp21Caption" },
  { ep: 44, captionKey: "previewEp44Caption" },
] as const;

function videoUrl(ep: number): string {
  return `${R2_PUBLIC}/videos/observation.images.ego_cam/chunk-000/episode_${String(ep).padStart(3, "0")}.mp4`;
}

export default async function SamplePage() {
  const t = await getTranslations("pages.sample");

  return (
    <div className={s.page}>
      {/* Hero */}
      <section className={s.hero}>
        <div className={s.heroInner}>
          <div className={s.heroMain}>
            <div className={s.heroEyebrow}>
              <span>{t("heroEyebrow")}</span>
              <span className={s.heroEyebrowDot}>·</span>
              <span className={s.heroEyebrowDesc}>{t("heroEyebrowDesc")}</span>
            </div>
            <h1 className={s.heroTitleArticle}>{t("heroTitle")}</h1>
            <p className={s.heroDescription}>{t("heroSubtitle")}</p>
            <div className={s.heroCtas} style={{ marginTop: 24 }}>
              <a
                href={`${R2_PUBLIC}/README.md`}
                target="_blank"
                rel="noopener noreferrer"
                className={s.ctaPrimary}
              >
                {t("ctaReadCard")}
                <span aria-hidden="true">→</span>
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* §01 What's in the box */}
      <section className={s.section}>
        <div className={s.sectionInner}>
          <h2 className={s.sectionTitle}>{t("s1Title")}</h2>
          <p className={s.prose}>{t("s1p1")}</p>
          <p className={s.prose}>{t("s1p2")}</p>
        </div>
      </section>

      {/* §02 Phase labels */}
      <section className={s.section}>
        <div className={s.sectionInner}>
          <h2 className={s.sectionTitle}>{t("s2Title")}</h2>
          <p className={s.prose}>{t("s2p1")}</p>
          <p className={s.prose}>{t("s2p2")}</p>
        </div>
      </section>

      {/* §03 What is NOT in this preview */}
      <section className={s.section}>
        <div className={s.sectionInner}>
          <h2 className={s.sectionTitle}>{t("s3Title")}</h2>
          <p className={s.prose}>{t("s3p1")}</p>
          <p className={s.prose}>{t("s3p2")}</p>
        </div>
      </section>

      {/* Inline preview videos */}
      <section className={s.section}>
        <div className={s.sectionInner}>
          <h2 className={s.sectionTitle}>{t("previewHeading")}</h2>
          <p className={s.prose}>{t("previewSubheading")}</p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: 24,
              marginTop: 32,
            }}
          >
            {PREVIEW_EPISODES.map(({ ep, captionKey }) => (
              <figure key={ep} style={{ margin: 0 }}>
                <video
                  controls
                  preload="metadata"
                  playsInline
                  style={{
                    width: "100%",
                    borderRadius: 8,
                    background: "#000",
                    display: "block",
                  }}
                  src={videoUrl(ep)}
                />
                <figcaption
                  style={{
                    marginTop: 8,
                    fontSize: "0.875rem",
                    color: "var(--lp-text-secondary)",
                  }}
                >
                  episode_{String(ep).padStart(3, "0")} · {t(captionKey)}
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      {/* §04 Episodes / tasks */}
      <section className={s.section}>
        <div className={s.sectionInner}>
          <h2 className={s.sectionTitle}>{t("s4Title")}</h2>
          <p className={s.prose}>{t("s4p1")}</p>
        </div>
      </section>

      {/* §05 Files */}
      <section className={s.section}>
        <div className={s.sectionInner}>
          <h2 className={s.sectionTitle}>{t("s5Title")}</h2>
          <p className={s.prose}>{t("s5p1")}</p>
          <div className={s.faqList} style={{ marginTop: 24 }}>
            <div className={s.faqRow}>
              <p className={s.faqQuestion}>data/chunk-000/file-000.parquet</p>
              <a
                href={`${R2_PUBLIC}/data/chunk-000/file-000.parquet`}
                className={`${s.ctaSecondary} ${s.faqButton}`}
              >
                {t("ctaDownloadParquet")}
              </a>
            </div>
            <div className={s.faqRow}>
              <p className={s.faqQuestion}>meta/tasks.jsonl</p>
              <a
                href={`${R2_PUBLIC}/meta/tasks.jsonl`}
                target="_blank"
                rel="noopener noreferrer"
                className={`${s.ctaSecondary} ${s.faqButton}`}
              >
                {t("ctaBrowseTasks")}
              </a>
            </div>
            <div className={s.faqRow}>
              <p className={s.faqQuestion}>meta/info.json</p>
              <a
                href={`${R2_PUBLIC}/meta/info.json`}
                target="_blank"
                rel="noopener noreferrer"
                className={`${s.ctaSecondary} ${s.faqButton}`}
              >
                {t("ctaInfoJson")}
              </a>
            </div>
            <div className={s.faqRow}>
              <p className={s.faqQuestion}>{t("faqTechQuestion")}</p>
              <a
                href={`${R2_PUBLIC}/README.md`}
                target="_blank"
                rel="noopener noreferrer"
                className={`${s.ctaSecondary} ${s.faqButton}`}
              >
                {t("faqTechCta")}
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* License */}
      <section className={s.section}>
        <div className={s.sectionInner}>
          <h2 className={s.sectionTitle}>{t("licenseHeading")}</h2>
          <p className={s.prose}>
            <span className={s.emphasis}>{t("licenseP1")}</span>
          </p>
        </div>
      </section>
    </div>
  );
}

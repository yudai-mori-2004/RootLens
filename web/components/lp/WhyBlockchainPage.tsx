import { getTranslations } from "next-intl/server";
import s from "./lp.module.css";

const WAITLIST_URL = "https://forms.gle/vKWyPLY9dQot6xq9A";

export default async function WhyBlockchainPage() {
  const t = await getTranslations("pages.whyBlockchain");

  return (
    <div className={s.page}>
      {/* Hero */}
      <section className={s.hero}>
        <div className={s.heroInner}>
          <div className={s.heroMain}>
            <div className={s.heroEyebrow}>
              <span>Essay</span>
              <span className={s.heroEyebrowDot}>·</span>
              <span className={s.heroEyebrowDesc}>Why we use blockchain</span>
            </div>
            <h1 className={s.heroTitleArticle}>{t("heroTitle")}</h1>
            <p className={s.heroDescription}>{t("heroSubtitle")}</p>
          </div>
        </div>
      </section>

      {/* Section 1: AI companies used to not care */}
      <section className={s.section}>
        <div className={s.sectionInner}>
          <h2 className={s.sectionTitle}>{t("s1Title")}</h2>
          <p className={s.prose}>{t("s1p1")}</p>
          <p className={s.prose}>{t("s1p2")}</p>
          <p className={s.prose} style={{ marginTop: 24 }}>
            <span className={s.emphasis}>{t("s1p3")}</span>
          </p>
        </div>
      </section>

      {/* Section 2: Big players get by on reputation */}
      <section className={s.section}>
        <div className={s.sectionInner}>
          <h2 className={s.sectionTitle}>{t("s2Title")}</h2>
          <p className={s.prose}>{t("s2p1")}</p>
          <p className={s.prose}>{t("s2p2")}</p>
          <p className={s.prose} style={{ marginTop: 24 }}>
            <span className={s.emphasis}>{t("s2p3")}</span>
          </p>
        </div>
      </section>

      {/* Section 3: We play the same game */}
      <section className={s.section}>
        <div className={s.sectionInner}>
          <h2 className={s.sectionTitle}>{t("s3Title")}</h2>
          <p className={s.prose}>{t("s3p1")}</p>
          <p className={s.prose}>{t("s3p2")}</p>
          <p className={s.prose} style={{ marginTop: 24 }}>
            <span className={s.emphasis}>{t("s3p3")}</span>
          </p>
        </div>
      </section>

      {/* Section 4: Publicly verifiable */}
      <section className={s.section}>
        <div className={s.sectionInner}>
          <h2 className={s.sectionTitle}>{t("s4Title")}</h2>
          <p className={s.prose}>{t("s4p1")}</p>
          <p className={s.prose}>{t("s4p2")}</p>
          <p className={s.prose}>{t("s4p3")}</p>
          <p className={s.prose} style={{ marginTop: 24 }}>
            <span className={s.emphasis}>{t("s4p4")}</span>
          </p>
        </div>
      </section>

      {/* Section 5: Why someone would choose us */}
      <section className={s.section}>
        <div className={s.sectionInner}>
          <h2 className={s.sectionTitle}>{t("s5Title")}</h2>
          <p className={s.prose}>{t("s5p1")}</p>
          <p className={s.prose}>{t("s5p2")}</p>
          <p className={s.prose}>{t("s5p3")}</p>
          <p className={s.prose}>{t("s5p4")}</p>
          <p className={s.prose}>{t("s5p5")}</p>
          <p className={s.prose}>{t("s5p6")}</p>
          <p className={s.prose}>{t("s5p7")}</p>
        </div>
      </section>

      {/* Closing CTA */}
      <section className={s.closingCta}>
        <div className={s.closingCtaInner}>
          <div className={s.closingCtaButtons}>
            <a
              href={WAITLIST_URL}
              className={s.ctaPrimary}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("ctaWaitlist")}
            </a>
            <a href="/" className={s.ctaSecondary}>
              RootLens
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}

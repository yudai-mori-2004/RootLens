import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import s from "./lp.module.css";

const WAITLIST_URL = "https://forms.gle/vKWyPLY9dQot6xq9A";
const REF_COUNT = 15;

function withFootnotes(text: string): ReactNode[] {
  return text.split(/(\[\d+\])/g).map((part, i) => {
    const m = part.match(/^\[(\d+)\]$/);
    if (!m) return part;
    const n = m[1];
    return (
      <sup key={i} className={s.footnoteMark}>
        <a href={`#ref-${n}`}>[{n}]</a>
      </sup>
    );
  });
}

export default async function LegalBasisPage() {
  const t = await getTranslations("pages.legalBasis");

  return (
    <div className={s.page}>
      {/* Hero */}
      <section className={s.hero}>
        <div className={s.heroInner}>
          <div className={s.heroMain}>
            <div className={s.heroEyebrow}>
              <span>Essay</span>
              <span className={s.heroEyebrowDot}>·</span>
              <span className={s.heroEyebrowDesc}>Legal foundation</span>
            </div>
            <h1 className={s.heroTitleArticle}>{t("heroTitle")}</h1>
            <p className={s.heroDescription}>{t("heroSubtitle")}</p>
          </div>
        </div>
      </section>

      {/* §1: NFT は「権利の引換券」 */}
      <section className={s.section}>
        <div className={s.sectionInner}>
          <h2 className={s.sectionTitle}>{t("s1Title")}</h2>
          <p className={s.prose}>{t("s1p1")}</p>
          <p className={s.prose}>{t("s1p2")}</p>
          <p className={s.prose}>{t("s1p3")}</p>
          <p className={s.prose} style={{ marginTop: 24 }}>
            <span className={s.emphasis}>{t("s1emphasis")}</span>
          </p>
        </div>
      </section>

      {/* §2: なぜ法的に有効なのか */}
      <section className={s.section}>
        <div className={s.sectionInner}>
          <h2 className={s.sectionTitle}>{t("s2Title")}</h2>
          <p className={s.prose}>{t("s2intro")}</p>
          <h3 className={s.subsectionTitle}>{t("s2q1")}</h3>
          <p className={s.prose}>{withFootnotes(t("s2a1"))}</p>
          <h3 className={s.subsectionTitle}>{t("s2q2")}</h3>
          <p className={s.prose}>{withFootnotes(t("s2a2"))}</p>
          <h3 className={s.subsectionTitle}>{t("s2q3")}</h3>
          <p className={s.prose}>{withFootnotes(t("s2a3"))}</p>
          <p className={s.prose} style={{ marginTop: 24 }}>
            <span className={s.emphasis}>{t("s2emphasis")}</span>
          </p>
        </div>
      </section>

      {/* §3: 想定されるリスクへの対応 */}
      <section className={s.section}>
        <div className={s.sectionInner}>
          <h2 className={s.sectionTitle}>{t("s3Title")}</h2>
          <p className={s.prose}>{t("s3intro")}</p>
          <h3 className={s.subsectionTitle}>{t("s3q1")}</h3>
          <p className={s.prose}>{withFootnotes(t("s3a1"))}</p>
          <h3 className={s.subsectionTitle}>{t("s3q2")}</h3>
          <p className={s.prose}>{t("s3a2")}</p>
          <h3 className={s.subsectionTitle}>{t("s3q3")}</h3>
          <p className={s.prose}>{t("s3a3")}</p>
          <p className={s.prose} style={{ marginTop: 24 }}>
            <span className={s.emphasis}>{t("s3emphasis")}</span>
          </p>
        </div>
      </section>

      {/* §4: もし問題が起きたら、 責任は誰が負うのか */}
      <section className={s.section}>
        <div className={s.sectionInner}>
          <h2 className={s.sectionTitle}>{t("s4Title")}</h2>
          <p className={s.prose}>{t("s4p1")}</p>
          <p className={s.prose}>{t("s4p2")}</p>
          <p className={s.prose}>{t("s4p3")}</p>
          <p className={s.prose}>{t("s4p4")}</p>
          <p className={s.prose}>{t("s4p5")}</p>
          <p className={s.prose} style={{ marginTop: 24 }}>
            <span className={s.emphasis}>{t("s4emphasis")}</span>
          </p>
        </div>
      </section>

      {/* §5: そもそもなぜライセンスを買う必要があるのか */}
      <section className={s.section}>
        <div className={s.sectionInner}>
          <h2 className={s.sectionTitle}>{t("s5Title")}</h2>
          <p className={s.prose}>{withFootnotes(t("s5p1"))}</p>
          <p className={s.prose}>{withFootnotes(t("s5p2"))}</p>
          <p className={s.prose} style={{ marginTop: 24 }}>
            <span className={s.emphasis}>{t("s5emphasis")}</span>
          </p>
        </div>
      </section>

      {/* §6: 確定 / 未確定 */}
      <section className={s.section}>
        <div className={s.sectionInner}>
          <h2 className={s.sectionTitle}>{t("s6Title")}</h2>
          <p className={s.prose}>{t("s6p1")}</p>
          <p className={s.prose}>{withFootnotes(t("s6p2"))}</p>
          <p className={s.prose}>{t("s6p3")}</p>
          <p className={s.prose} style={{ marginTop: 24 }}>
            <span className={s.emphasis}>{t("s6emphasis")}</span>
          </p>
        </div>
      </section>

      {/* References */}
      <section className={s.section}>
        <div className={s.sectionInner}>
          <h2 className={s.referencesTitle}>{t("refsTitle")}</h2>
          <ol className={s.referencesList}>
            {Array.from({ length: REF_COUNT }, (_, i) => i + 1).map((n) => (
              <li key={n} id={`ref-${n}`} className={s.referencesItem}>
                <span className={s.referencesNumber}>[{n}]</span>{" "}
                {t(`ref${n}`)}
              </li>
            ))}
          </ol>
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

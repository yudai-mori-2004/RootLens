import { getTranslations } from "next-intl/server";
import s from "./lp.module.css";

const WAITLIST_URL = "https://forms.gle/vKWyPLY9dQot6xq9A";

export default async function HomePage() {
  const tHero = await getTranslations("lp.hero");
  const tProblem = await getTranslations("lp.problem");
  const tFlow = await getTranslations("lp.appFlow");
  const tIssues = await getTranslations("lp.issues");
  const tHome = await getTranslations("pages.home");
  const tc = await getTranslations("common");

  const flowSteps = ["step1", "step2", "step3"] as const;
  const issues = ["hands", "guidance", "scoring", "privacy"] as const;

  return (
    <div className={s.page}>
      {/* Hero */}
      <section className={s.hero}>
        <div className={s.heroInner}>
          <div className={s.heroMain}>
            <div className={s.heroEyebrow}>
              <span>RootLens</span>
              <span className={s.heroEyebrowDot}>·</span>
              <span className={s.heroEyebrowDesc}>Robot training data, sourced from real homes</span>
            </div>
            <h1 className={s.heroTitle}>
              Film your day.<br />
              Train robots.<br />
              <span className={s.heroTitleAccent}>Get paid.</span>
            </h1>
            <p className={s.heroDescription}>{tHero("description")}</p>
            <div className={s.heroCtas}>
              <a href={WAITLIST_URL} className={s.ctaPrimary} target="_blank" rel="noopener noreferrer">
                Join the early waitlist
                <span aria-hidden="true">→</span>
              </a>
              <a href="/sample" className={s.ctaSecondary}>
                {tHero("ctaSample")}
                <span aria-hidden="true">→</span>
              </a>
            </div>
            <div className={s.storeBadges} style={{ marginTop: 24 }}>
              <div className={s.storeBadge}>
                <AppleIcon />
                <div className={s.storeBadgeText}>
                  <span className={s.storeBadgeLabel}>{tc("comingSoon")}</span>
                  <span className={s.storeBadgeName}>App Store</span>
                </div>
              </div>
            </div>
          </div>
          <aside className={s.heroMeta}>
            <div className={s.heroMetaLabel}>STATUS</div>
            <div className={s.heroMetaValue}>MVP LIVE</div>
            <div style={{ height: 12 }} />
            <div className={s.heroMetaLabel}>WAITLIST</div>
            <div className={s.heroMetaValue}>100+ CREATORS</div>
            <div style={{ height: 12 }} />
            <div className={s.heroMetaLabel}>NETWORK</div>
            <div className={s.heroMetaValue}>SOLANA</div>
          </aside>
        </div>
      </section>

      {/* §01 Problem */}
      <section className={s.section}>
        <div className={s.sectionInner}>
          <header className={s.sectionHeader}>
            <div className={s.sectionNumber}>§01</div>
            <div>
              <div className={s.sectionLabel}>The problem</div>
              <h2 className={s.sectionTitle}>{tProblem("title")}</h2>
            </div>
          </header>
          <div className={s.sectionBodyWithIllustration}>
            <div className={s.sectionBodyContentNarrow}>
              <p className={s.prose}>{tProblem("p1")}</p>
              <p className={s.prose}>{tProblem("p2")}</p>
              <p className={s.prose} style={{ marginTop: 28 }}>
                <span className={s.emphasis}>{tProblem("p3")}</span>
              </p>
            </div>
            <div className={s.sectionIllustration}>
              <img src="/lp/problem.webp" alt="" width={800} height={800} loading="lazy" />
            </div>
          </div>
        </div>
      </section>

      {/* §02 How it works */}
      <section className={s.section}>
        <div className={s.sectionInner}>
          <header className={s.sectionHeader}>
            <div className={s.sectionNumber}>§02</div>
            <div>
              <div className={s.sectionLabel}>How it works</div>
              <h2 className={s.sectionTitle}>{tFlow("title")}</h2>
            </div>
          </header>
          <div className={s.steps}>
            {flowSteps.map((key, i) => {
              const icons = ["/lp/step-record.webp", "/lp/step-validate.webp", "/lp/step-earn.webp"];
              return (
                <div key={key} className={s.step}>
                  <div className={s.stepIcon}>
                    <img src={icons[i]} alt="" width={400} height={400} loading="lazy" />
                  </div>
                  <div className={s.stepNumber}>0{i + 1} / 03</div>
                  <div className={s.stepLabel}>{tFlow(`${key}.label`)}</div>
                  <div className={s.stepText}>{tFlow(`${key}.text`)}</div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* §03 Why the data is valuable */}
      <section className={s.section}>
        <div className={s.sectionInner}>
          <header className={s.sectionHeader}>
            <div className={s.sectionNumber}>§03</div>
            <div>
              <div className={s.sectionLabel}>What buyers want</div>
              <h2 className={s.sectionTitle}>{tIssues("title")}</h2>
            </div>
          </header>
          <div className={s.sectionBody}>
            <div className={s.sectionBodyContent}>
              <p className={s.prose}>{tIssues("intro1")}</p>
              <p className={s.prose}>{tIssues("intro2")}</p>
              <p className={s.prose} style={{ marginTop: 28, marginBottom: 0 }}>
                <span className={s.emphasis}>{tIssues("pillarsLead")}</span>
              </p>
            </div>
          </div>
          <div className={s.issuesGrid} style={{ marginTop: 40 }}>
            {issues.map((key) => (
              <div key={key} className={s.issueItem}>
                <div className={s.issueLabel}>{tIssues(`${key}.label`)}</div>
                <div className={s.issueText}>{tIssues(`${key}.text`)}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* §04 Closing CTA */}
      <section className={s.closingCta}>
        <div className={s.closingCtaInner}>
          <div className={s.closingCtaVisual}>
            <img src="/lp/cta.webp" alt="" width={600} height={600} loading="lazy" />
          </div>
          <div className={s.closingCtaNumber}>§04</div>
          <div className={s.closingCtaMain}>
            <div className={s.closingCtaLabel}>Get started</div>
            <h2 className={s.closingCtaTitle}>{tHome("closingTitle")}</h2>
            <p className={s.closingCtaDesc}>{tHome("closingDesc")}</p>
          </div>
          <div className={s.closingCtaButtons}>
            <a href={WAITLIST_URL} className={s.ctaPrimary} target="_blank" rel="noopener noreferrer">
              Join the early waitlist
              <span aria-hidden="true">→</span>
            </a>
            <a href="/why-blockchain" className={s.ctaSecondary}>
              {tHome("whyBlockchainLink")}
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}

function AppleIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
    </svg>
  );
}


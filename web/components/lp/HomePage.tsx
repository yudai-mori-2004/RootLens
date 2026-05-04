import { getTranslations } from "next-intl/server";
import s from "./lp.module.css";

const WAITLIST_URL = "https://forms.gle/vKWyPLY9dQot6xq9A";

export default async function HomePage() {
  const tProblem = await getTranslations("lp.problem");
  const tFlow = await getTranslations("lp.appFlow");
  const tIssues = await getTranslations("lp.issues");
  const tHome = await getTranslations("pages.home");
  const tc = await getTranslations("common");

  const flowSteps = ["step1", "step2", "step3"] as const;
  const issues = ["sns", "media", "insurance", "ai"] as const;

  return (
    <div className={s.page}>
      {/* Hero */}
      <section className={s.hero}>
        <div className={s.heroInner}>
          <p className={s.heroEyebrow}>The camera app</p>
          <h1 className={s.heroTitle}>Film your day.<br />Train home robots.<br />Get paid.</h1>
          <p className={s.heroDescription}>RootLens is a marketplace where anyone can record household tasks and sell that data to home robot companies.</p>
          <a href={WAITLIST_URL} className={s.ctaPrimary} target="_blank" rel="noopener noreferrer">
            Join the early waitlist →
          </a>
          <div className={s.storeBadges} style={{ marginTop: 16 }}>
            <div className={s.storeBadge}>
              <AppleIcon />
              <div className={s.storeBadgeText}>
                <span className={s.storeBadgeLabel}>{tc("comingSoon")}</span>
                <span className={s.storeBadgeName}>App Store</span>
              </div>
            </div>
            <div className={s.storeBadge}>
              <PlayIcon />
              <div className={s.storeBadgeText}>
                <span className={s.storeBadgeLabel}>{tc("comingSoon")}</span>
                <span className={s.storeBadgeName}>Google Play</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Problem */}
      <section className={s.section}>
        <div className={s.sectionInner}>
          <h2 className={s.sectionTitle}>{tProblem("title")}</h2>
          <p className={s.prose}>{tProblem("p1")}</p>
          <p className={s.prose}>{tProblem("p2")}</p>
          <p className={s.prose}>{tProblem("p3")}</p>
          <p className={s.prose} style={{ marginTop: 24 }}>
            <span className={s.emphasis}>{tProblem("example")}</span>
          </p>
          <p className={s.prose}>{tProblem("p4")}</p>
          <p className={s.prose}>{tProblem("p5")}</p>
          <p className={s.prose}>{tProblem("p6")}</p>
          <p className={s.prose} style={{ marginTop: 24 }}>
            <span className={s.emphasis}>{tProblem("p7")}</span>
          </p>
        </div>
      </section>

      {/* How it works */}
      <section className={s.section}>
        <div className={s.sectionInner}>
          <h2 className={s.sectionTitle}>{tFlow("title")}</h2>
          <div className={s.steps}>
            {flowSteps.map((key, i) => (
              <div key={key} className={s.step}>
                <div className={s.stepNumber}>{i + 1}</div>
                <div>
                  <div className={s.stepLabel}>{tFlow(`${key}.label`)}</div>
                  <div className={s.stepText}>{tFlow(`${key}.text`)}</div>
                </div>
              </div>
            ))}
          </div>
          <p className={s.prose} style={{ marginTop: 24 }}>
            <span className={s.emphasis}>{tFlow("editing")}</span>
          </p>
        </div>
      </section>

      {/* What makes the data valuable */}
      <section className={s.section}>
        <div className={s.sectionInner}>
          <h2 className={s.sectionTitle}>{tIssues("title")}</h2>
          <p className={s.sectionSubtitle}>{tIssues("intro")}</p>
          <div className={s.issuesGrid}>
            {issues.map((key) => (
              <div key={key} className={s.issueItem}>
                <div className={s.issueLabel}>{tIssues(`${key}.label`)}</div>
                <div className={s.issueText}>{tIssues(`${key}.text`)}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Closing CTA */}
      <section className={s.closingCta}>
        <div className={s.closingCtaInner}>
          <div className={s.closingCtaTitle}>{tHome("closingTitle")}</div>
          <div className={s.closingCtaDesc}>{tHome("closingDesc")}</div>
          <div className={s.closingCtaButtons}>
            <a href={WAITLIST_URL} className={s.ctaPrimary} target="_blank" rel="noopener noreferrer">
              Join the early waitlist →
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

function PlayIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
      <path d="M3 20.5v-17c0-.83.52-1.28 1.09-1.28.18 0 .37.05.56.15l15.32 8.5c.55.31.72.77.72 1.13s-.17.82-.72 1.13L4.65 21.63c-.19.1-.38.15-.56.15C3.52 21.78 3 21.33 3 20.5z" />
    </svg>
  );
}

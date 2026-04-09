/**
 * /docs/introduction — "why this system exists" story page.
 * Server component for SSR (bot/AI readable).
 * Only the tech details toggle is a client component.
 */

import { getTranslations } from "next-intl/server";
import s from "./lp.module.css";
import GapDiagram from "./GapDiagram";
import TechToggle from "./TechToggle";

const GITHUB_TP = "https://github.com/yudai-mori-2004/title-protocol";
const GITHUB_RL = "https://github.com/yudai-mori-2004/root-lens";

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

export default async function IntroductionPage() {
  const tPage = await getTranslations("pages.technology");
  const tC2pa = await getTranslations("lp.c2pa");
  const tGap = await getTranslations("lp.gap");
  const tTp = await getTranslations("lp.tp");
  const tComp = await getTranslations("lp.comparison");
  const tRl = await getTranslations("lp.rootlens");
  const tOs = await getTranslations("lp.openSource");

  const tpSteps = ["step1", "step2", "step3", "step4"] as const;
  const techItems = ["stateless", "e2ee", "coreExt", "cost", "security"] as const;
  const scenarios = ["scenario1", "scenario2", "scenario3", "scenario4"] as const;
  const rlFlowSteps = ["step1", "step2", "step3", "step4"] as const;

  return (
    <div className={s.page}>
      {/* Hero */}
      <section className={s.hero}>
        <div className={s.heroInner}>
          <h1 className={s.heroTitle}>{tPage("heroTitle")}</h1>
          <p className={s.heroDescription}>{tPage("heroSubtitle")}</p>
        </div>
      </section>

      {/* C2PA */}
      <section className={s.section}>
        <div className={s.sectionInner}>
          <h2 className={s.sectionTitle}>{tC2pa("title")}</h2>
          <p className={s.prose}>{tC2pa("p1")}</p>
          <p className={s.prose}>{tC2pa("p2")}</p>
          <p className={s.prose}>{tC2pa("p3")}</p>
          <p className={s.prose}>{tC2pa("p4")}</p>
          <p className={s.prose}>
            <span className={s.emphasis}>{tC2pa("p5")}</span>
          </p>
          <p className={s.prose}>{tC2pa("p6")}</p>
        </div>
      </section>

      {/* Gap */}
      <section className={s.section}>
        <div className={s.sectionInner}>
          <h2 className={s.sectionTitle}>{tGap("title")}</h2>
          <p className={s.prose}>{tGap("p1")}</p>
          <p className={s.prose}>{tGap("p2")}</p>
        </div>
        <div style={{ maxWidth: 680, margin: "32px auto 0" }}>
          <GapDiagram />
        </div>
        <div className={s.sectionInner} style={{ marginTop: 32 }}>
          <p className={s.prose}>{tGap("p3")}</p>
          <p className={s.prose}>{tGap("p4")}</p>
          <p className={s.prose}>
            <span className={s.emphasis}>{tGap("p5")}</span>
          </p>
        </div>
      </section>

      {/* Title Protocol */}
      <section className={s.section}>
        <div className={s.sectionInner}>
          <h2 className={s.sectionTitle}>{tTp("title")}</h2>
          <p className={s.sectionSubtitle}>{tTp("subtitle")}</p>
          <p className={s.prose}>{tTp("p1")}</p>
          <p className={s.prose}>{tTp("p2")}</p>

          <div className={s.steps}>
            {tpSteps.map((key, i) => (
              <div key={key} className={s.step}>
                <div className={s.stepNumber}>{i + 1}</div>
                <div>
                  <div className={s.stepLabel}>{tTp(`${key}.label`)}</div>
                  <div className={s.stepText}>{tTp(`${key}.text`)}</div>
                </div>
              </div>
            ))}
          </div>

          <TechToggle title={tTp("techDetails.title")}>
            <div>
              {techItems.map((key) => (
                <div key={key} className={s.techItem}>
                  <div className={s.techLabel}>{tTp(`techDetails.${key}.label`)}</div>
                  <div className={s.techText}>{tTp(`techDetails.${key}.text`)}</div>
                </div>
              ))}
            </div>
          </TechToggle>

          <p className={s.prose} style={{ marginTop: 32 }}>
            <a href="/docs/trust-model" className={s.link}>{tTp("docsLink")}</a>
          </p>
        </div>
      </section>

      {/* Comparison */}
      <section className={s.section}>
        <div className={s.sectionInner}>
          <h2 className={s.sectionTitle}>{tComp("title")}</h2>
          <p className={s.sectionSubtitle}>{tComp("intro")}</p>
          <div className={s.comparisonList}>
            {scenarios.map((key) => (
              <div key={key} className={s.comparisonItem}>
                <div className={s.comparisonLabel}>{tComp(`${key}.label`)}</div>
                <div className={s.comparisonText}>{tComp(`${key}.text`)}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* RootLens */}
      <section className={s.section}>
        <div className={s.sectionInner}>
          <h2 className={s.sectionTitle}>{tRl("title")}</h2>
          <p className={s.sectionSubtitle}>{tRl("subtitle")}</p>
          <p className={s.prose}>{tRl("p1")}</p>

          <div className={s.rootlensFlow}>
            {rlFlowSteps.map((key, i) => (
              <div key={key} className={s.flowStep}>
                <span className={s.flowNumber}>{i + 1}.</span>
                <span>{tRl(key)}</span>
              </div>
            ))}
          </div>

          <p className={s.prose} style={{ marginTop: 32 }}>
            {tRl("permanence")}
          </p>
          <p className={s.prose}>
            <span className={s.emphasis}>{tRl("targets")}</span>
          </p>
          <p className={s.prose} style={{ marginTop: 32 }}>
            <a href="/docs/content-origins" className={s.link}>{tRl("docsLink")}</a>
          </p>
        </div>
      </section>

      {/* Open Source */}
      <section className={s.section}>
        <div className={s.sectionInner}>
          <h2 className={s.sectionTitle}>{tOs("title")}</h2>
          <p className={s.prose}>{tOs("spec")}</p>
          <p className={s.prose}>{tOs("node")}</p>

          <div className={s.repoLinks}>
            <a href={GITHUB_TP} target="_blank" rel="noopener noreferrer" className={s.repoLink}>
              <GitHubIcon className={s.repoIcon} />
              {tOs("tpRepo")}
            </a>
            <a href={GITHUB_RL} target="_blank" rel="noopener noreferrer" className={s.repoLink}>
              <GitHubIcon className={s.repoIcon} />
              {tOs("rlRepo")}
            </a>
          </div>

          <p className={s.prose}>{tOs("code")}</p>
        </div>
      </section>
    </div>
  );
}

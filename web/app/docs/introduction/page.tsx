import { getTranslations } from "next-intl/server";
import s from "../../../components/docs/docs.module.css";
import DocsNav from "../../../components/docs/DocsNav";
import GapDiagram from "../../../components/lp/GapDiagram";
import TechToggle from "../../../components/lp/TechToggle";

export const metadata = {
  title: "Introduction",
  description: "Why C2PA alone is not enough, and how Title Protocol solves it.",
};

const GITHUB_TP = "https://github.com/yudai-mori-2004/title-protocol";
const GITHUB_RL = "https://github.com/yudai-mori-2004/root-lens";

function GitHubIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" style={{ width: 16, height: 16, flexShrink: 0 }}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

export default async function DocsIntroduction() {
  const tPage = await getTranslations("pages.technology");
  const tC2pa = await getTranslations("lp.c2pa");
  const tGap = await getTranslations("lp.gap");
  const tTp = await getTranslations("lp.tp");
  const tComp = await getTranslations("lp.comparison");
  const tRl = await getTranslations("lp.rootlens");
  const tOs = await getTranslations("lp.openSource");
  const tn = await getTranslations("docs.nav");
  const ts = await getTranslations("docs.sidebar");

  const tpSteps = ["step1", "step2", "step3", "step4"] as const;
  const techItems = ["stateless", "e2ee", "coreExt", "cost", "security"] as const;
  const scenarios = ["scenario1", "scenario2", "scenario3", "scenario4"] as const;
  const rlFlowSteps = ["step1", "step2", "step3", "step4"] as const;

  return (
    <article className={s.article}>
      <h1 className={s.title}>{tPage("heroTitle")}</h1>
      <p className={s.subtitle}>{tPage("heroSubtitle")}</p>

      {/* C2PA */}
      <h2 className={s.h2}>{tC2pa("title")}</h2>
      <p className={s.p}>{tC2pa("p1")}</p>
      <p className={s.p}>{tC2pa("p2")}</p>
      <p className={s.p}>{tC2pa("p3")}</p>
      <p className={s.p}>{tC2pa("p4")}</p>
      <p className={s.p}><span className={s.strong}>{tC2pa("p5")}</span></p>
      <p className={s.p}>{tC2pa("p6")}</p>

      {/* Gap */}
      <h2 className={s.h2}>{tGap("title")}</h2>
      <p className={s.p}>{tGap("p1")}</p>
      <p className={s.p}>{tGap("p2")}</p>
      <div style={{ margin: "24px 0", maxWidth: "100%", overflow: "hidden" }}>
        <GapDiagram />
      </div>
      <p className={s.p}>{tGap("p3")}</p>
      <p className={s.p}>{tGap("p4")}</p>
      <p className={s.p}><span className={s.strong}>{tGap("p5")}</span></p>

      {/* Title Protocol */}
      <h2 className={s.h2}>{tTp("title")}</h2>
      <p className={s.p}><span className={s.strong}>{tTp("subtitle")}</span></p>
      <p className={s.p}>{tTp("p1")}</p>
      <p className={s.p}>{tTp("p2")}</p>

      <ol className={s.steps}>
        {tpSteps.map((key) => (
          <li key={key}>
            <div className={s.stepLabel}>{tTp(`${key}.label`)}</div>
            <div className={s.stepSub}>{tTp(`${key}.text`)}</div>
          </li>
        ))}
      </ol>

      <TechToggle title={tTp("techDetails.title")}>
        <table className={s.table}>
          <tbody>
            {techItems.map((key) => (
              <tr key={key}>
                <td><code className={s.code}>{tTp(`techDetails.${key}.label`)}</code></td>
                <td>{tTp(`techDetails.${key}.text`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TechToggle>

      <p className={s.p}>
        <a href="/docs/trust-model" className={s.link}>{tTp("docsLink")}</a>
      </p>

      {/* Comparison */}
      <h2 className={s.h2}>{tComp("title")}</h2>
      <p className={s.p}>{tComp("intro")}</p>
      <ul className={s.list}>
        {scenarios.map((key) => (
          <li key={key}>
            <span className={s.strong}>{tComp(`${key}.label`)}</span>
            {" "}{tComp(`${key}.text`)}
          </li>
        ))}
      </ul>

      {/* RootLens */}
      <h2 className={s.h2}>{tRl("title")}</h2>
      <p className={s.p}><span className={s.strong}>{tRl("subtitle")}</span></p>
      <p className={s.p}>{tRl("p1")}</p>

      <ol className={s.steps}>
        {rlFlowSteps.map((key) => (
          <li key={key}>{tRl(key)}</li>
        ))}
      </ol>

      <p className={s.p}>{tRl("permanence")}</p>
      <p className={s.p}><span className={s.strong}>{tRl("targets")}</span></p>
      <p className={s.p}>
        <a href="/docs/content-origins" className={s.link}>{tRl("docsLink")}</a>
      </p>

      {/* Open Source */}
      <h2 className={s.h2}>{tOs("title")}</h2>
      <p className={s.p}>{tOs("spec")}</p>
      <p className={s.p}>{tOs("node")}</p>

      <ul className={s.list}>
        <li>
          <a href={GITHUB_TP} target="_blank" rel="noopener noreferrer" className={s.link}>
            <GitHubIcon /> {tOs("tpRepo")}
          </a>
        </li>
        <li>
          <a href={GITHUB_RL} target="_blank" rel="noopener noreferrer" className={s.link}>
            <GitHubIcon /> {tOs("rlRepo")}
          </a>
        </li>
      </ul>

      <p className={s.p}>{tOs("code")}</p>

      <DocsNav
        next={{ href: "/docs", title: ts("overview") }}
        nextLabel={tn("next")}
      />
    </article>
  );
}

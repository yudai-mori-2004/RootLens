import { getTranslations } from "next-intl/server";
import s from "../../components/docs/docs.module.css";
import DocsNav from "../../components/docs/DocsNav";

export const metadata = { title: "Overview" };

export default async function DocsOverview() {
  const t = await getTranslations("docs.overview");
  const tn = await getTranslations("docs.nav");
  const ts = await getTranslations("docs.sidebar");

  const TERMS = [
    { term: "C2PA", def: t("termC2pa") },
    { term: "TEE", def: t("termTee") },
    { term: "cNFT", def: t("termCnft") },
    { term: "signed_json", def: t("termSignedJson") },
    { term: "content_hash", def: t("termContentHash") },
    { term: "Perceptual hash (PDQ)", def: t("termPdq") },
    { term: "GlobalConfig", def: t("termGlobalConfig") },
  ] as const;

  const PHASES = [
    {
      label: t("phase1label"), title: t("phase1title"),
      steps: [t("phase1step1"), t("phase1step2")],
      question: t("phase1question"), trust: t("phase1trustShort"),
    },
    {
      label: t("phase2label"), title: t("phase2title"),
      steps: [t("phase2step1"), t("phase2step2"), t("phase2step3")],
      question: t("phase2question"), trust: t("phase2trustShort"),
    },
    {
      label: t("phase3label"), title: t("phase3title"),
      steps: [t("phase3step1"), t("phase3step2"), t("phase3step3")],
      question: t("phase3question"), trust: t("phase3trustShort"),
    },
  ];

  return (
    <article className={s.article}>
      <h1 className={s.title}>{t("title")}</h1>
      <p className={s.subtitle}>{t("subtitle")}</p>

      <h2 className={s.h2}>{t("bgTitle")}</h2>
      <p className={s.p}>{t("bgP1")}</p>
      <p className={s.p}>{t("bgP2")}</p>
      <p className={s.p}>
        {t("bgP3")}
        <a href="/technology" className={s.link}>{t("bgTechLink")}</a>
        {t("bgP3after")}
      </p>

      <h2 className={s.h2}>{t("whatTitle")}</h2>
      <p className={s.p}>
        {t("whatP1before")}
        <span className={s.strong}>{t("whatP1bold")}</span>
        {t("whatP1after")}
      </p>
      <p className={s.p}>
        {t("whatP2a")}
        <span className={s.strong}>{t("whatP2teeBold")}</span>
        {t("whatP2b")}
        <span className={s.strong}>{t("whatP2nobodyBold")}</span>
        {t("whatP2c")}
      </p>
      <p className={s.p}>{t("whatP3chain")}</p>

      <h2 className={s.h2}>{t("userTitle")}</h2>
      <p className={s.p}>
        {t("userP1before")}
        <code className={s.code}>{t("userP1link")}</code>
        {t("userP1after")}
      </p>

      <h2 className={s.h2}>{t("termsTitle")}</h2>
      <p className={s.p}>{t("termsIntro")}</p>
      <table className={s.table}>
        <thead>
          <tr>
            <th>{t("termHeader")}</th>
            <th>{t("termDefHeader")}</th>
          </tr>
        </thead>
        <tbody>
          {TERMS.map(({ term, def }) => (
            <tr key={term}>
              <td><span className={s.strong}>{term}</span></td>
              <td>{def}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className={s.h2}>{t("phasesTitle")}</h2>
      <p className={s.p}>{t("phasesIntro")}</p>

      <div className={s.phaseCards}>
        {PHASES.map((phase) => (
          <div key={phase.label} className={s.phaseCard}>
            <div className={s.phaseCardHeader}>
              <span className={s.phaseCardLabel}>{phase.label}</span>
              <span className={s.phaseCardTitle}>{phase.title}</span>
            </div>
            <div className={s.phaseCardSteps}>
              {phase.steps.map((step, i) => (
                <div key={i} className={s.phaseCardStep}>{step}</div>
              ))}
            </div>
            <div className={s.phaseCardFooter}>
              <div className={s.phaseCardQuestion}>{phase.question}</div>
              <div className={s.phaseCardTrust}>{phase.trust}</div>
            </div>
          </div>
        ))}
      </div>

      <table className={s.table}>
        <thead>
          <tr>
            <th>{t("phaseHeader")}</th>
            <th>{t("phaseProvesHeader")}</th>
            <th>{t("phaseTrustHeader")}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><span className={s.strong}>{t("phase1name")}</span></td>
            <td>{t("phase1proves")}</td>
            <td>{t("phase1trust")}</td>
          </tr>
          <tr>
            <td><span className={s.strong}>{t("phase2name")}</span></td>
            <td>{t("phase2proves")}</td>
            <td>{t("phase2trust")}</td>
          </tr>
          <tr>
            <td><span className={s.strong}>{t("phase3name")}</span></td>
            <td>{t("phase3proves")}</td>
            <td>{t("phase3trust")}</td>
          </tr>
        </tbody>
      </table>

      <h2 className={s.h2}>{t("sourcesTitle")}</h2>
      <p className={s.p}>{t("sourcesP1")}</p>

      <DocsNav
        next={{ href: "/docs/trust-model", title: ts("trustModel") }}
        nextLabel={tn("next")}
      />
    </article>
  );
}

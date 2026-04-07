import { getTranslations } from "next-intl/server";
import s from "../../../components/docs/docs.module.css";
import DocsNav from "../../../components/docs/DocsNav";

export const metadata = { title: "Client-Side Verification" };

const ATTACKS = [1, 2, 3, 4, 5, 6] as const;

export default async function VerificationPage() {
  const t = await getTranslations("docs.verification");
  const tn = await getTranslations("docs.nav");
  const ts = await getTranslations("docs.sidebar");

  return (
    <article className={s.article}>
      <h1 className={s.title}>{t("title")}</h1>
      <p className={s.subtitle}>{t("subtitle")}</p>

      <h2 className={s.h2}>{t("flowTitle")}</h2>
      <p className={s.p}>
        {t("flowIntroBefore")}
        <code className={s.code}>{t("flowIntroLink")}</code>
        {t("flowIntroMid")}
        <code className={s.code}>{t("flowIntroCode")}</code>
        {t("flowIntroAfter")}
      </p>
      <ol className={s.steps}>
        <li>
          <div className={s.stepLabel}>Short ID &rarr; content_hash</div>
          <div className={s.stepSub}>
            {t("flowStep1")}
          </div>
        </li>
        <li>
          <div className={s.stepLabel}>content_hash &rarr; cNFT candidates</div>
          <div className={s.stepSub}>
            {t("flowStep2")}
          </div>
        </li>
        <li>
          <div className={s.stepLabel}>cNFT ID &rarr; on-chain verification</div>
          <div className={s.stepSub}>
            {t("flowStep3")}
          </div>
        </li>
        <li>
          <div className={s.stepLabel}>signed_json &rarr; browser verification</div>
          <div className={s.stepSub}>
            {t("flowStep4")}
          </div>
        </li>
      </ol>
      <div className={s.callout}>
        <div className={s.calloutLabel}>{t("flowNote")}</div>
      </div>

      <h2 className={s.h2}>{t("commonTitle")}</h2>
      <p className={s.p}>{t("commonIntro")}</p>

      <h3 className={s.h3}>{t("check1Title")}</h3>
      <p className={s.p}>{t("check1P1")}</p>

      <h3 className={s.h3}>{t("check2Title")}</h3>
      <p className={s.p}>
        {t("check2P1a")}
        <code className={s.code}>{t("check2P1code1")}</code>
        {t("check2P1b")}
        <code className={s.code}>{t("check2P1code2")}</code>
        {t("check2P1c")}
        <code className={s.code}>{t("check2P1code3")}</code>
        {t("check2P1d")}
        <code className={s.code}>{t("check2P1code4")}</code>
        {t("check2P1e")}
      </p>
      <p className={s.p}>{t("check2P2")}</p>

      <h3 className={s.h3}>{t("check3Title")}</h3>
      <p className={s.p}>
        <code className={s.code}>{t("check3P1code1")}</code>
        {t("check3P1mid")}
        <code className={s.code}>{t("check3P1code2")}</code>
        {t("check3P1after")}
      </p>

      <h2 className={s.h2}>{t("coreChecksTitle")}</h2>

      <h3 className={s.h3}>{t("check4Title")}</h3>
      <p className={s.p}>{t("check4P1")}</p>

      <h3 className={s.h3}>{t("check5Title")}</h3>
      <p className={s.p}>
        {t("check5P1before")}
        <code className={s.code}>{t("check5P1code")}</code>
        {t("check5P1after")}
      </p>

      <h2 className={s.h2}>{t("extChecksTitle")}</h2>

      <h3 className={s.h3}>{t("check6Title")}</h3>
      <p className={s.p}>
        {t("check6P1a")}
        <code className={s.code}>{t("check6P1code1")}</code>
        {t("check6P1b")}
        <code className={s.code}>{t("check6P1code2")}</code>
        {t("check6P1c")}
      </p>

      <h3 className={s.h3}>{t("check7Title")}</h3>
      <p className={s.p}>
        {t("check7P1a")}
        <code className={s.code}>{t("check7P1code1")}</code>
        {t("check7P1b")}
        <code className={s.code}>{t("check7P1code2")}</code>
        {t("check7P1c")}
      </p>

      <h3 className={s.h3}>{t("check8Title")}</h3>
      <p className={s.p}>{t("check8P1")}</p>
      <p className={s.p}>{t("check8P2")}</p>

      <h3 className={s.h3}>{t("check9Title")}</h3>
      <p className={s.p}>{t("check9P1")}</p>

      <h2 className={s.h2}>{t("verdictTitle")}</h2>
      <p className={s.p}>
        {t("verdictP1a")}
        <code className={s.code}>{t("verdictP1code1")}</code>
        {t("verdictP1b")}
        <span className={s.strong}>{t("verdictP1bold")}</span>
        {t("verdictP1c")}
        <code className={s.code}>{t("verdictP1code2")}</code>
        {t("verdictP1d")}
      </p>

      <h2 className={s.h2}>{t("attackTitle")}</h2>
      <table className={s.table}>
        <thead>
          <tr>
            <th>{t("attackHeader")}</th>
            <th>{t("defenseHeader")}</th>
          </tr>
        </thead>
        <tbody>
          {ATTACKS.map((n) => (
            <tr key={n}>
              <td>{t(`attack${n}` as any)}</td>
              <td>{t(`defense${n}` as any)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className={s.h2}>{t("consoleTitle")}</h2>
      <p className={s.p}>{t("consoleP1")}</p>

      <DocsNav
        prev={{ href: "/docs/cnft-structure", title: ts("cnftStructure") }}
        next={{ href: "/docs/pki", title: ts("pkiArchitecture") }}
        prevLabel={tn("prev")}
        nextLabel={tn("next")}
      />
    </article>
  );
}

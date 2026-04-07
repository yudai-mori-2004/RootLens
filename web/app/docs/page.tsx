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

  const DIAGRAM = `Phase 1                   Phase 2                   Phase 3
CONTENT CREATION          VERIFICATION & RECORD     ANYONE CAN RE-VERIFY
─────────────────         ────────────────────       ───────────────────

Camera sensor              Title Protocol TEE        Viewer's browser
  ↓                          ↓                         ↓
C2PA signature             Receives encrypted        Fetches proof from
(device key)               content, verifies the     blockchain, re-verifies
  ↓                        C2PA chain inside TEE,    the TEE signature,
Content with               signs results with a      recomputes the visual
provenance data            hardware-isolated key     fingerprint from the
                             ↓                       displayed image
                           Records results as          ↓
                           cNFTs on Solana           Shows verified / failed

"Who took this?"           "Is it real?"             "Can I trust this?"
Depends on device          TEE hardware              Re-verifies Phase 2
                                                     proofs locally`;

  return (
    <article className={s.article}>
      <h1 className={s.title}>{t("title")}</h1>
      <p className={s.subtitle}>{t("subtitle")}</p>

      <h2 className={s.h2}>{t("whatTitle")}</h2>
      <p className={s.p}>
        {t.rich("whatP1", {
          authentic: (c) => <span className={s.strong}>{c}</span>,
        })}
      </p>
      <p className={s.p}>
        {t.rich("whatP2tee", {
          tee: (c) => <span className={s.strong}>{c}</span>,
          nobodyCanExtract: (c) => <span className={s.strong}>{c}</span>,
        })}
      </p>
      <p className={s.p}>{t("whatP3chain")}</p>

      <h2 className={s.h2}>{t("userTitle")}</h2>
      <p className={s.p}>
        {t.rich("userP1", {
          exampleLink: () => (
            <code className={s.code}>rootlens.io/p/abc123</code>
          ),
        })}
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

      <div className={s.diagram}>{DIAGRAM}</div>

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

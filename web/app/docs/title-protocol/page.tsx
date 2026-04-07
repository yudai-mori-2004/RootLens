import { getTranslations } from "next-intl/server";
import s from "../../../components/docs/docs.module.css";
import DocsNav from "../../../components/docs/DocsNav";

export const metadata = { title: "Title Protocol" };

const SIGNED_JSON_EXAMPLE = `{
  "protocol": "Title-v1",
  "tee_pubkey": "<public key, Base64>",
  "tee_signature": "<signature, Base64>",
  "tee_signature_algorithm": "Ed25519",  // current algorithm
  "payload": {
    "content_hash": "<SHA-256 of original content>",
    // processor-specific fields...
  },
  "attributes": { ... }
}`;

const PROCESSORS = [
  { org: "Google", ids: ["core-c2pa", "cert-google", "image-pdq"] },
  { org: "Sony", ids: ["core-c2pa", "cert-sony", "image-pdq"] },
  { org: "Leica", ids: ["core-c2pa", "cert-leica", "image-pdq"] },
  { org: "RootLens", ids: ["core-c2pa", "cert-rootlens", "image-pdq"] },
] as const;

export default async function TitleProtocolPage() {
  const t = await getTranslations("docs.titleProtocol");
  const tn = await getTranslations("docs.nav");
  const ts = await getTranslations("docs.sidebar");

  return (
    <article className={s.article}>
      <h1 className={s.title}>{t("title")}</h1>
      <p className={s.subtitle}>{t("subtitle")}</p>

      <h2 className={s.h2}>{t("whatTitle")}</h2>
      <p className={s.p}>
        {t("whatP1before")}
        <span className={s.strong}>{t("whatP1bold")}</span>
        {t("whatP1after")}
      </p>
      <p className={s.p}>
        {t("whatP2before")}
        <span className={s.strong}>{t("whatP2bold")}</span>
        {t("whatP2after")}
      </p>
      <p className={s.p}>{t("whatP3")}</p>

      <h3 className={s.h3}>{t("agnosticTitle")}</h3>
      <p className={s.p}>
        {t("agnosticP1before")}
        <code className={s.code}>{t("agnosticP1code")}</code>
        {t("agnosticP1after")}
      </p>

      <h3 className={s.h3}>{t("rlAppTitle")}</h3>
      <p className={s.p}>{t("rlAppP1")}</p>

      <h2 className={s.h2}>{t("e2eTitle")}</h2>
      <p className={s.p}>{t("e2eIntro")}</p>
      <div className={s.sequence}>
        <div className={s.sequenceHeader}>App</div>
        <div className={s.sequenceHeader}>TEE Node</div>

        <div className={s.sequenceCell}>
          <div className={s.sequenceCellLabel}>1. Look up TEE public key</div>
          from on-chain GlobalConfig
        </div>
        <div className={s.sequenceCell} />

        <div className={s.sequenceCell}>
          <div className={s.sequenceCellLabel}>2. Key exchange</div>
          Ephemeral ECDH &rarr; shared secret (forward secrecy)
        </div>
        <div className={s.sequenceCell} />

        <div className={s.sequenceCell}>
          <div className={s.sequenceCellLabel}>3. Derive directional keys</div>
          Separate keys for app&rarr;TEE and TEE&rarr;app
        </div>
        <div className={s.sequenceCell} />

        <div className={s.sequenceArrow}>
          4. Encrypted content &rarr;
        </div>

        <div className={s.sequenceCell} />
        <div className={s.sequenceCell}>
          <div className={s.sequenceCellLabel}>5. Process inside TEE</div>
          Decrypt, verify C2PA, run processors, sign results
        </div>

        <div className={s.sequenceArrow}>
          &larr; 6. Encrypted results
        </div>

        <div className={s.sequenceCell}>
          <div className={s.sequenceCellLabel}>7. Decrypt locally</div>
        </div>
        <div className={s.sequenceCell} />
      </div>
      <p className={s.p}>{t("e2eConclusion")}</p>

      <h2 className={s.h2}>{t("processorTitle")}</h2>
      <p className={s.p}>
        {t("processorIntroBefore")}
        <code className={s.code}>{t("processorIntroCode")}</code>
        {t("processorIntroAfter")}
      </p>

      <table className={s.table}>
        <thead>
          <tr><th>signer_org</th><th>processor_ids</th></tr>
        </thead>
        <tbody>
          {PROCESSORS.map(({ org, ids }) => (
            <tr key={org}>
              <td>&ldquo;{org}&rdquo;</td>
              <td>{ids.map((id, i) => (
                <span key={id}>{i > 0 && ", "}<code className={s.code}>{id}</code></span>
              ))}</td>
            </tr>
          ))}
          <tr>
            <td>(any, video)</td>
            <td>
              <code className={s.code}>image-pdq</code> → <code className={s.code}>video-vpdq</code>
            </td>
          </tr>
        </tbody>
      </table>

      <div className={s.callout}>
        <div className={s.calloutLabel}>{t("processorCalloutLabel")}</div>
        {t("processorCalloutA")}
        <code className={s.code}>{t("processorCalloutCode1")}</code>
        {t("processorCalloutB")}
        <span className={s.strong}>{t("processorCalloutBold")}</span>
        {t("processorCalloutC")}
      </div>

      <h2 className={s.h2}>{t("producesTitle")}</h2>
      <p className={s.p}>
        {t("producesP1before")}
        <code className={s.code}>{t("producesP1code")}</code>
        {t("producesP1after")}
      </p>
      <div className={s.codeBlock}>{SIGNED_JSON_EXAMPLE}</div>
      <p className={s.p}>
        {t("producesP2a")}
        <code className={s.code}>{t("producesP2code1")}</code>
        {t("producesP2b")}
        <code className={s.code}>{t("producesP2code2")}</code>
        {t("producesP2c")}
      </p>

      <h2 className={s.h2}>{t("wasmTitle")}</h2>
      <p className={s.p}>
        {t("wasmP1before")}
        <code className={s.code}>{t("wasmP1code")}</code>
        {t("wasmP1after")}
      </p>
      <p className={s.p}>
        {t("wasmP2before")}
        <code className={s.code}>{t("wasmP2code")}</code>
        {t("wasmP2after")}
      </p>

      <h2 className={s.h2}>{t("mintTitle")}</h2>
      <p className={s.p}>{t("mintP1")}</p>
      <ul className={s.list}>
        <li>
          <span className={s.strong}>{t("mintCoreLabel")}</span>
          {" "}(<code className={s.code}>{t("mintCoreCode")}</code>)
          {t("mintCoreText")}
        </li>
        <li>
          <span className={s.strong}>{t("mintCertLabel")}</span>
          {" "}(<code className={s.code}>{t("mintCertCode")}</code>)
          {t("mintCertText")}
        </li>
        <li>
          <span className={s.strong}>{t("mintPdqLabel")}</span>
          {" "}(<code className={s.code}>{t("mintPdqCode1")}</code>
          {t("mintPdqOr")}
          <code className={s.code}>{t("mintPdqCode2")}</code>)
          {t("mintPdqText")}
        </li>
      </ul>
      <p className={s.p}>
        {t("mintP2a")}
        <code className={s.code}>{t("mintP2code1")}</code>
        {t("mintP2b")}
        <code className={s.code}>{t("mintP2code2")}</code>
        {t("mintP2c")}
      </p>
      <p className={s.p}>
        {t("mintLinkBefore")}
        <a href="/docs/cnft-structure" className={s.link}>{t("mintLinkText")}</a>
        {t("mintLinkAfter")}
      </p>

      <DocsNav
        prev={{ href: "/docs/content-origins", title: ts("howContentIsSigned") }}
        next={{ href: "/docs/cnft-structure", title: ts("cnftStructure") }}
        prevLabel={tn("prev")}
        nextLabel={tn("next")}
      />
    </article>
  );
}

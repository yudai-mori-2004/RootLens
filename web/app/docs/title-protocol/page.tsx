import { getTranslations } from "next-intl/server";
import s from "../../../components/docs/docs.module.css";
import DocsNav from "../../../components/docs/DocsNav";

export const metadata = { title: "Title Protocol" };

const E2E_DIAGRAM = `App                                  TEE Node
────                                 ────────

1. Look up the TEE node's public key
   (from on-chain GlobalConfig)

2. Establish a shared secret
   (ephemeral key exchange — provides
    forward secrecy: even if a key is
    later compromised, past sessions
    remain protected)

3. Derive separate encryption keys
   for each direction (app→TEE, TEE→app)

4. Encrypt the content locally
   and upload the ciphertext
         │
         └────────────────────────→  5. Decrypt inside TEE
                                        Verify C2PA chain
                                        Run processors
                                        Sign results
   6. Receive encrypted results  ◀──────┘
      Decrypt locally`;

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
        {t.rich("whatP1", {
          verifiable: (c) => <span className={s.strong}>{c}</span>,
        })}
      </p>
      <p className={s.p}>
        {t.rich("whatP2", {
          nobodySees: (c) => <span className={s.strong}>{c}</span>,
        })}
      </p>
      <p className={s.p}>{t("whatP3")}</p>

      <h3 className={s.h3}>{t("agnosticTitle")}</h3>
      <p className={s.p}>
        {t.rich("agnosticP1", {
          cert: () => <code className={s.code}>cert-*</code>,
        })}
      </p>

      <h3 className={s.h3}>{t("rlAppTitle")}</h3>
      <p className={s.p}>{t("rlAppP1")}</p>

      <h2 className={s.h2}>{t("e2eTitle")}</h2>
      <p className={s.p}>{t("e2eIntro")}</p>
      <div className={s.diagram}>{E2E_DIAGRAM}</div>
      <p className={s.p}>{t("e2eConclusion")}</p>

      <h2 className={s.h2}>{t("processorTitle")}</h2>
      <p className={s.p}>
        {t.rich("processorIntro", {
          signerOrg: () => <code className={s.code}>signer_org</code>,
        })}
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
        {t.rich("processorCallout", {
          cert: () => <code className={s.code}>cert-*</code>,
          rootCa: (c) => <span className={s.strong}>{c}</span>,
        })}
      </div>

      <h2 className={s.h2}>{t("producesTitle")}</h2>
      <p className={s.p}>
        {t.rich("producesP1", {
          signedJson: () => <code className={s.code}>signed_json</code>,
        })}
      </p>
      <div className={s.codeBlock}>{SIGNED_JSON_EXAMPLE}</div>
      <p className={s.p}>
        {t.rich("producesP2", {
          jcs: () => <code className={s.code}>{"JCS({ payload, attributes })"}</code>,
          domainTag: () => <code className={s.code}>title-protocol-v1</code>,
        })}
      </p>

      <h2 className={s.h2}>{t("wasmTitle")}</h2>
      <p className={s.p}>
        {t.rich("wasmP1", {
          trustedWasm: () => <code className={s.code}>trusted_wasm_modules</code>,
        })}
      </p>
      <p className={s.p}>
        {t.rich("wasmP2", {
          wasmHash: () => <code className={s.code}>wasm_hash</code>,
        })}
      </p>

      <h2 className={s.h2}>{t("mintTitle")}</h2>
      <p className={s.p}>{t("mintP1")}</p>
      <ul className={s.list}>
        <li>
          {t.rich("mintCore", {
            label: (c) => <span className={s.strong}>{c}</span>,
            code: () => <code className={s.code}>core-c2pa</code>,
          })}
        </li>
        <li>
          {t.rich("mintCert", {
            label: (c) => <span className={s.strong}>{c}</span>,
            code: () => <code className={s.code}>cert-*</code>,
          })}
        </li>
        <li>
          {t.rich("mintPdq", {
            label: (c) => <span className={s.strong}>{c}</span>,
            code: () => <code className={s.code}>image-pdq</code>,
            code2: () => <code className={s.code}>video-vpdq</code>,
          })}
        </li>
      </ul>
      <p className={s.p}>
        {t.rich("mintP2", {
          jsonUri: () => <code className={s.code}>json_uri</code>,
          signedJson: () => <code className={s.code}>signed_json</code>,
        })}
      </p>
      <p className={s.p}>
        {t.rich("mintLink", {
          link: () => <a href="/docs/cnft-structure" className={s.link}>cNFT Structure</a>,
        })}
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

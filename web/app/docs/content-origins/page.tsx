import { getTranslations } from "next-intl/server";
import s from "../../../components/docs/docs.module.css";
import DocsNav from "../../../components/docs/DocsNav";

export const metadata = { title: "How Content Is Signed" };

const HW_DIAGRAM = `
  Camera      Image         Secure        C2PA
  Sensor ──▶  Processing ──▶ Chip     ──▶ Signature
               (ISP)        (Titan M2)

  * Signing key is factory-bound
  * Cannot be extracted from the chip
`.trim();

const APP_DIAGRAM = `
  Camera         TEE                 C2PA
  API (OS) ──▶  (Secure Enclave / ──▶ Signature
                 StrongBox)

  * Private key generated in TEE, never exported
  * Sensor ──▶ TEE path goes through the OS
`.trim();

const PKI_DIAGRAM = `
  Root CA (AWS KMS, 20-year validity)
  ├── iOS Intermediate CA (AWS KMS)
  │   └── Device Cert (90-day, TEE public key)
  │
  └── Android Intermediate CA (AWS KMS)
      └── Device Cert (90-day, TEE public key)
`.trim();

export default async function ContentOriginsPage() {
  const t = await getTranslations("docs.contentOrigins");
  const tn = await getTranslations("docs.nav");
  const ts = await getTranslations("docs.sidebar");

  const COMP_ROWS = [
    { key: "TrustOrigin", label: t("compTrustOrigin") },
    { key: "Sensor", label: t("compSensor") },
    { key: "Key", label: t("compKey") },
    { key: "Cert", label: t("compCert") },
  ] as const;

  const PROV_ROWS = [1, 2, 3, 4] as const;

  return (
    <article className={s.article}>
      <h1 className={s.title}>{t("title")}</h1>
      <p className={s.subtitle}>{t("subtitle")}</p>

      {/* Hardware */}
      <h2 className={s.h2} id="hardware">{t("hwTitle")}</h2>
      <p className={s.p}>{t("hwP1")}</p>
      <div className={s.diagram}>{HW_DIAGRAM}</div>

      <table className={s.table}>
        <thead>
          <tr>
            <th>{t("hwDeviceHeader")}</th>
            <th>{t("hwChipHeader")}</th>
            <th>{t("hwProvesHeader")}</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>Google Pixel</td><td>Titan M2</td><td>{t("hwPixel")}</td></tr>
          <tr><td>Sony / Leica</td><td>Vendor secure element</td><td>{t("hwSony")}</td></tr>
        </tbody>
      </table>

      <p className={s.p}>
        <span className={s.strong}>{t("hwTrustBasisLabel")}</span>
        {t("hwTrustBasisText")}
      </p>
      <p className={s.p}>
        <span className={s.strong}>{t("hwRulesOutLabel")}</span>
        {t("hwRulesOutText")}
      </p>

      {/* App-Level */}
      <h2 className={s.h2} id="app">{t("appTitle")}</h2>
      <p className={s.p}>{t("appP1")}</p>
      <div className={s.diagram}>{APP_DIAGRAM}</div>
      <p className={s.p}>{t("appMechanisms")}</p>

      <h3 className={s.h3}>{t("appAttestation")}</h3>
      <p className={s.p}>{t("appAttestationP1")}</p>
      <ul className={s.list}>
        <li>
          <span className={s.strong}>{t("appAttestationAndroidLabel")}</span>
          {t("appAttestationAndroidText")}
        </li>
        <li>
          <span className={s.strong}>{t("appAttestationIosLabel")}</span>
          {t("appAttestationIosBefore")}
          <code className={s.code}>{t("appAttestationIosCode")}</code>
          {t("appAttestationIosAfter")}
        </li>
      </ul>

      <h3 className={s.h3}>{t("appTeeTitle")}</h3>
      <p className={s.p}>{t("appTeeP1")}</p>

      <h3 className={s.h3}>{t("appPkiTitle")}</h3>
      <p className={s.p}>{t("appPkiP1")}</p>
      <div className={s.diagram}>{PKI_DIAGRAM}</div>
      <p className={s.p}>
        {t("appPkiLinkBefore")}
        <a href="/docs/pki" className={s.link}>{t("appPkiLinkText")}</a>
        {t("appPkiLinkAfter")}
      </p>

      <h3 className={s.h3}>{t("tradeoffTitle")}</h3>
      <div className={s.callout}>
        <div className={s.calloutLabel}>{t("tradeoffLabel")}</div>
        {t("tradeoffText")}
      </div>

      {/* Comparison */}
      <h2 className={s.h2}>{t("comparisonTitle")}</h2>
      <table className={s.table}>
        <thead>
          <tr>
            <th>{t("compAspect")}</th>
            <th>{t("compHw")}</th>
            <th>{t("compApp")}</th>
          </tr>
        </thead>
        <tbody>
          {COMP_ROWS.map(({ key, label }) => (
            <tr key={key}>
              <td>{label}</td>
              <td>{t(`comp${key}Hw` as any)}</td>
              <td>{t(`comp${key}App` as any)}</td>
            </tr>
          ))}
          <tr>
            <td>Cert extension</td>
            <td><code className={s.code}>cert-google</code>, <code className={s.code}>cert-sony</code></td>
            <td><code className={s.code}>cert-rootlens</code></td>
          </tr>
          {["Pipeline", "Display"].map((row) => (
            <tr key={row}>
              <td>{t(`comp${row}` as any)}</td>
              <td>{row === "Pipeline" ? t("compSame") : t("compDisplayHw")}</td>
              <td>{row === "Pipeline" ? t("compSame") : t("compDisplayApp")}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className={s.callout}>
        <div className={s.calloutLabel}>{t("keyPointLabel")}</div>
        {t("keyPointText")}
      </div>

      {/* Provenance */}
      <h2 className={s.h2} id="provenance">{t("provenanceTitle")}</h2>
      <p className={s.p}>
        {t("provenanceP1before")}
        <span className={s.strong}>{t("provenanceP1bold")}</span>
        {t("provenanceP1after")}
      </p>

      <table className={s.table}>
        <thead>
          <tr>
            <th>{t("provenanceScenario")}</th>
            <th>{t("provenanceChain")}</th>
            <th>{t("provenanceDisplay")}</th>
          </tr>
        </thead>
        <tbody>
          {PROV_ROWS.map((n) => (
            <tr key={n}>
              <td>{t(`prov${n}scenario` as any)}</td>
              <td>{t(`prov${n}chain` as any)}</td>
              <td>{t(`prov${n}display` as any)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className={s.p}>{t("provenanceP2")}</p>

      <DocsNav
        prev={{ href: "/docs/trust-model", title: ts("trustModel") }}
        next={{ href: "/docs/title-protocol", title: ts("titleProtocol") }}
        prevLabel={tn("prev")}
        nextLabel={tn("next")}
      />
    </article>
  );
}

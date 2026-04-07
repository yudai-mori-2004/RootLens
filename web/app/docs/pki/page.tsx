import { getTranslations } from "next-intl/server";
import s from "../../../components/docs/docs.module.css";
import DocsNav from "../../../components/docs/DocsNav";

export const metadata = { title: "PKI Architecture" };

export default async function PkiPage() {
  const t = await getTranslations("docs.pki");
  const tn = await getTranslations("docs.nav");
  const ts = await getTranslations("docs.sidebar");

  return (
    <article className={s.article}>
      <h1 className={s.title}>{t("title")}</h1>
      <p className={s.subtitle}>{t("subtitle")}</p>

      <div className={s.callout}>
        <div className={s.calloutLabel}>{t("scopeLabel")}</div>
        {t("scopeTextBefore")}
        <span className={s.strong}>{t("scopeTextBold")}</span>
        {t("scopeTextAfter")}
      </div>

      <h2 className={s.h2}>{t("hierarchyTitle")}</h2>
      <ul className={s.tree}>
        <li>
          <span className={s.treeLabel}>Root CA</span>
          <span className={s.treeSub}>AWS KMS, 20 years</span>
          <ul>
            <li>
              <span className={s.treeLabel}>iOS Intermediate CA</span>
              <span className={s.treeSub}>AWS KMS</span>
              <ul>
                <li>Device Certificate <span className={s.treeSub}>90-day, TEE key</span></li>
              </ul>
            </li>
            <li>
              <span className={s.treeLabel}>Android Intermediate CA</span>
              <span className={s.treeSub}>AWS KMS</span>
              <ul>
                <li>Device Certificate <span className={s.treeSub}>90-day, TEE key</span></li>
              </ul>
            </li>
          </ul>
        </li>
      </ul>

      <table className={s.table}>
        <thead>
          <tr>
            <th></th>
            <th>Root CA</th>
            <th>Intermediate CA</th>
            <th>Device Cert</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><span className={s.strong}>Algorithm</span></td>
            <td>ECDSA P-256</td>
            <td>ECDSA P-256</td>
            <td>ECDSA P-256</td>
          </tr>
          <tr>
            <td><span className={s.strong}>Storage</span></td>
            <td>AWS KMS</td>
            <td>AWS KMS</td>
            <td>Device TEE</td>
          </tr>
          <tr>
            <td><span className={s.strong}>Validity</span></td>
            <td>20 years</td>
            <td>—</td>
            <td>90 days</td>
          </tr>
          <tr>
            <td><span className={s.strong}>CA</span></td>
            <td>TRUE, pathLen:1</td>
            <td>TRUE, pathLen:0</td>
            <td>FALSE</td>
          </tr>
          <tr>
            <td><span className={s.strong}>Key Usage</span></td>
            <td>keyCertSign, cRLSign</td>
            <td>keyCertSign</td>
            <td>digitalSignature</td>
          </tr>
        </tbody>
      </table>

      <h2 className={s.h2}>{t("designTitle")}</h2>

      <h3 className={s.h3}>{t("isolationTitle")}</h3>
      <p className={s.p}>
        {t("isolationP1before")}
        <code className={s.code}>{t("isolationP1code")}</code>
        {t("isolationP1after")}
      </p>

      <h3 className={s.h3}>{t("shortLivedTitle")}</h3>
      <p className={s.p}>{t("shortLivedP1")}</p>

      <h3 className={s.h3}>{t("kmsTitle")}</h3>
      <p className={s.p}>{t("kmsP1")}</p>

      <h2 className={s.h2}>{t("issuanceTitle")}</h2>
      <div className={s.sequence}>
        <div className={s.sequenceHeader}>Device</div>
        <div className={s.sequenceHeader}>Server</div>

        <div className={s.sequenceCell}>
          <div className={s.sequenceCellLabel}>1. Generate key pair in TEE</div>
          EC P-256 (Secure Enclave / StrongBox)
        </div>
        <div className={s.sequenceCell} />

        <div className={s.sequenceCell}>
          <div className={s.sequenceCellLabel}>2. Create CSR</div>
          Self-signed = Proof of Possession
        </div>
        <div className={s.sequenceCell} />

        <div className={s.sequenceCell}>
          <div className={s.sequenceCellLabel}>3. Platform Attestation</div>
          iOS: App Attest / Android: Key Attestation + Play Integrity
        </div>
        <div className={s.sequenceCell} />

        <div className={s.sequenceArrow}>
          4. CSR + Attestation &rarr;
        </div>

        <div className={s.sequenceCell} />
        <div className={s.sequenceCell}>
          <div className={s.sequenceCellLabel}>5-7. Verify</div>
          CSR signature, key algorithm, Platform Attestation
        </div>

        <div className={s.sequenceCell} />
        <div className={s.sequenceCell}>
          <div className={s.sequenceCellLabel}>8. Sign Device Certificate</div>
          ICA key via KMS
        </div>

        <div className={s.sequenceArrow}>
          &larr; 9. Device Cert + ICA Cert + Root Cert
        </div>

        <div className={s.sequenceCell}>
          <div className={s.sequenceCellLabel}>10. Store cert chain in TEE</div>
          Auto-renewal 14 days before expiry
        </div>
        <div className={s.sequenceCell} />
      </div>

      <h2 className={s.h2}>{t("bindingTitle")}</h2>
      <p className={s.p}>{t("bindingIntro")}</p>

      <table className={s.table}>
        <thead>
          <tr>
            <th>{t("platformHeader")}</th>
            <th>{t("methodHeader")}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><span className={s.strong}>Android Key Attestation</span></td>
            <td>{t("androidKeyAttest")}</td>
          </tr>
          <tr>
            <td><span className={s.strong}>Android Play Integrity</span></td>
            <td>
              {t("androidPlayIntegrityBefore")}
              <code className={s.code}>{t("androidPlayIntegrityCode")}</code>
              {t("androidPlayIntegrityAfter")}
            </td>
          </tr>
          <tr>
            <td><span className={s.strong}>iOS App Attest</span></td>
            <td>
              {t("iosAppAttestBefore")}
              <code className={s.code}>{t("iosAppAttestCode")}</code>
              {t("iosAppAttestAfter")}
            </td>
          </tr>
        </tbody>
      </table>

      <h2 className={s.h2}>{t("crlTitle")}</h2>
      <p className={s.p}>
        {t("crlP1before")}
        <code className={s.code}>{t("crlP1code")}</code>
        {t("crlP1after")}
      </p>

      <h2 className={s.h2}>{t("rotationTitle")}</h2>
      <p className={s.p}>{t("rotationP1")}</p>

      <DocsNav
        prev={{ href: "/docs/verification", title: ts("clientSideVerification") }}
        prevLabel={tn("prev")}
      />
    </article>
  );
}

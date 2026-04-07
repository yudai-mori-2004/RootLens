import { getTranslations } from "next-intl/server";
import s from "../../../components/docs/docs.module.css";
import DocsNav from "../../../components/docs/DocsNav";

export const metadata = { title: "PKI Architecture" };

const HIERARCHY_DIAGRAM = `Root CA
  |
  +-- iOS Intermediate CA
  |     |
  |     +-- Device Cert (iOS)
  |
  +-- Android Intermediate CA
        |
        +-- Device Cert (Android)`;

const ISSUANCE_DIAGRAM = `Device                              Server
------                              ------

1. Generate EC P-256 key pair
   inside TEE
   (Secure Enclave / StrongBox)

2. Create PKCS#10 CSR
   (self-signed with private key
    = Proof of Possession)

3. Obtain Platform Attestation
   iOS:     App Attest
            clientDataHash
            = SHA-256(CSR)
   Android: Key Attestation chain
            + Play Integrity
            nonce = SHA-256(CSR)
              |
4. Send CSR  |
 + Attestation ------------->  5. Verify CSR
                                  self-signature
                                  (Proof of Possession)

                               6. Verify public key
                                  algorithm
                                  (must be EC P-256)

                               7. Verify Platform
                                  Attestation
                                  iOS:  clientDataHash
                                        matches CSR
                                  Android: CSR pubkey
                                  == attestation
                                     cert[0] pubkey

                               8. Sign Device Cert
                                  with ICA key
                                  (via KMS)

                               9. Record issuance
                                  in DB
                                  (for CRL & audit)
                                        |
10. Receive certs  <--------------------+
    Device Cert + ICA Cert + Root Cert

11. Store 3-layer cert chain
    in TEE alongside key pair

12. Use for C2PA signing
    Renewal: 14 days before expiry
    (background, non-blocking)`;

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
      <div className={s.diagram}>{HIERARCHY_DIAGRAM}</div>

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
      <div className={s.diagram}>{ISSUANCE_DIAGRAM}</div>

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

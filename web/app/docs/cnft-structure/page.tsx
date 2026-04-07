import { getTranslations } from "next-intl/server";
import s from "../../../components/docs/docs.module.css";
import DocsNav from "../../../components/docs/DocsNav";

export const metadata = { title: "cNFT Structure" };

const OVERVIEW_DIAGRAM = `                        ┌─────────────────────────┐
                        │     Core cNFT           │
content_hash ──────────→│     (core-c2pa)          │
                        │     Provenance graph     │
                        └─────────────────────────┘
                                    │
                     ┌──────────────┼──────────────┐
                     ▼              ▼              ▼
              ┌────────────┐ ┌────────────┐ ┌────────────┐
              │ cert-*     │ │ image-pdq  │ │ video-vpdq │
              │ Extension  │ │ Extension  │ │ Extension  │
              │            │ │            │ │            │
              │ Cert chain │ │ 256-bit    │ │ Per-frame  │
              │ verified?  │ │ PDQ hash   │ │ PDQ hashes │
              └────────────┘ └────────────┘ └────────────┘

All cNFTs share the same content_hash.
Core cNFT belongs to core_collection_mint.
Extension cNFTs belong to ext_collection_mint.`;

export default async function CnftStructurePage() {
  const t = await getTranslations("docs.cnftStructure");
  const tn = await getTranslations("docs.nav");
  const ts = await getTranslations("docs.sidebar");

  return (
    <article className={s.article}>
      <h1 className={s.title}>{t("title")}</h1>
      <p className={s.subtitle}>{t("subtitle")}</p>

      <h2 className={s.h2}>{t("overviewTitle")}</h2>
      <div className={s.diagram}>{OVERVIEW_DIAGRAM}</div>

      {/* Core cNFT */}
      <h2 className={s.h2}>{t("coreTitle")}</h2>
      <p className={s.p}>{t("coreP1")}</p>

      <h3 className={s.h3}>{t("payloadTitle")}</h3>
      <table className={s.table}>
        <thead><tr><th>{t("fieldHeader")}</th><th>{t("typeHeader")}</th><th>{t("descHeader")}</th></tr></thead>
        <tbody>
          <tr><td><code className={s.code}>content_hash</code></td><td>string</td><td>{t("coreContentHash")}</td></tr>
          <tr><td><code className={s.code}>nodes[]</code></td><td>array</td><td>{t("coreNodes")}</td></tr>
          <tr><td><code className={s.code}>links[]</code></td><td>array</td><td>{t("coreLinks")}</td></tr>
          <tr><td><code className={s.code}>tsa_timestamp</code></td><td>number?</td><td>{t("coreTsa")}</td></tr>
        </tbody>
      </table>

      <h3 className={s.h3}>{t("attrTitle")}</h3>
      <table className={s.table}>
        <thead><tr><th>{t("attrHeader")}</th><th>{t("exampleHeader")}</th></tr></thead>
        <tbody>
          <tr><td><code className={s.code}>content_hash</code></td><td><code className={s.code}>a1b2c3d4...</code></td></tr>
          <tr><td><code className={s.code}>device_name</code></td><td><code className={s.code}>Pixel 8 Pro</code></td></tr>
          <tr><td><code className={s.code}>captured_at</code></td><td><code className={s.code}>2025-01-15T10:30:00Z</code></td></tr>
          <tr><td><code className={s.code}>assurance_level</code></td><td><code className={s.code}>2</code> {t("attrAssurance")}</td></tr>
          <tr><td><code className={s.code}>content_type</code></td><td><code className={s.code}>image/jpeg</code></td></tr>
        </tbody>
      </table>

      <h3 className={s.h3}>{t("checksTitle")}</h3>
      <ul className={s.list}>
        {(["checkCollection", "checkTeeSig", "checkBinding", "checkProvenance", "checkOriginality"] as const).map((k) => (
          <li key={k}><span className={s.strong}>{t(`${k}Label` as any)}</span> — {t(`${k}Text` as any)}</li>
        ))}
      </ul>

      {/* Cert Extension */}
      <h2 className={s.h2}>{t("certTitle")}</h2>
      <p className={s.p}>{t("certP1")}</p>
      <ul className={s.list}>
        <li><code className={s.code}>cert-google</code> — {t("certGoogle")}</li>
        <li><code className={s.code}>cert-sony</code> — {t("certSony")}</li>
        <li><code className={s.code}>cert-leica</code> — {t("certLeica")}</li>
        <li><code className={s.code}>cert-rootlens</code> — {t("certRootlens")}</li>
      </ul>

      <h3 className={s.h3}>{t("payloadTitle")}</h3>
      <table className={s.table}>
        <thead><tr><th>{t("fieldHeader")}</th><th>{t("typeHeader")}</th><th>{t("descHeader")}</th></tr></thead>
        <tbody>
          <tr><td><code className={s.code}>content_hash</code></td><td>string</td><td>{t("certContentHash")}</td></tr>
          <tr><td><code className={s.code}>extension_id</code></td><td>string</td><td>{t("certExtId")}</td></tr>
          <tr><td><code className={s.code}>wasm_hash</code></td><td>string</td><td>{t("certWasmHash")}</td></tr>
          <tr><td><code className={s.code}>verified</code></td><td>boolean</td><td>{t("certVerified")}</td></tr>
          <tr><td><code className={s.code}>root_ca</code></td><td>string?</td><td>{t("certRootCa")}</td></tr>
        </tbody>
      </table>

      <h3 className={s.h3}>{t("checksTitle")}</h3>
      <ul className={s.list}>
        {(["checkExtCollection", "checkTeeSig", "checkBinding", "checkWasm", "checkCertVerified"] as const).map((k) => (
          <li key={k}><span className={s.strong}>{t(`${k}Label` as any)}</span> — {t(`${k}Text` as any)}</li>
        ))}
      </ul>

      {/* Image PDQ */}
      <h2 className={s.h2}>{t("pdqTitle")}</h2>
      <p className={s.p}>{t("pdqP1")}</p>

      <h3 className={s.h3}>{t("payloadTitle")}</h3>
      <table className={s.table}>
        <thead><tr><th>{t("fieldHeader")}</th><th>{t("typeHeader")}</th><th>{t("descHeader")}</th></tr></thead>
        <tbody>
          <tr><td><code className={s.code}>content_hash</code></td><td>string</td><td>{t("pdqContentHash")}</td></tr>
          <tr><td><code className={s.code}>extension_id</code></td><td>string</td><td><code className={s.code}>image-pdq</code></td></tr>
          <tr><td><code className={s.code}>wasm_hash</code></td><td>string</td><td>{t("pdqWasmHash")}</td></tr>
          <tr><td><code className={s.code}>pdqhash</code></td><td>string</td><td>{t("pdqHash")}</td></tr>
        </tbody>
      </table>

      <h3 className={s.h3}>{t("pdqHowTitle")}</h3>
      <p className={s.p}>{t("pdqHowP1")}</p>

      <h3 className={s.h3}>{t("pdqVerifyTitle")}</h3>
      <p className={s.p}>
        {t("pdqVerifyP1before")}
        <span className={s.strong}>{t("pdqVerifyP1bold")}</span>
        {t("pdqVerifyP1after")}
      </p>

      {/* Video vPDQ */}
      <h2 className={s.h2}>{t("vpdqTitle")}</h2>
      <p className={s.p}>{t("vpdqP1")}</p>

      <h3 className={s.h3}>{t("payloadTitle")}</h3>
      <table className={s.table}>
        <thead><tr><th>{t("fieldHeader")}</th><th>{t("typeHeader")}</th><th>{t("descHeader")}</th></tr></thead>
        <tbody>
          <tr><td><code className={s.code}>extension_id</code></td><td>string</td><td><code className={s.code}>video-vpdq</code></td></tr>
          <tr><td><code className={s.code}>wasm_hash</code></td><td>string</td><td>SHA-256</td></tr>
          <tr><td><code className={s.code}>frames[]</code></td><td>array</td><td>{t("vpdqFrames")}</td></tr>
          <tr><td><code className={s.code}>frames[].pdqhash</code></td><td>string</td><td>{t("vpdqPdqhash")}</td></tr>
          <tr><td><code className={s.code}>frames[].quality</code></td><td>number</td><td>{t("vpdqQuality")}</td></tr>
          <tr><td><code className={s.code}>frames[].keyframe</code></td><td>number</td><td>{t("vpdqKeyframe")}</td></tr>
        </tbody>
      </table>

      <h3 className={s.h3}>{t("pdqVerifyTitle")}</h3>
      <p className={s.p}>{t("vpdqVerifyP1")}</p>

      <DocsNav
        prev={{ href: "/docs/title-protocol", title: ts("titleProtocol") }}
        next={{ href: "/docs/verification", title: ts("clientSideVerification") }}
        prevLabel={tn("prev")}
        nextLabel={tn("next")}
      />
    </article>
  );
}

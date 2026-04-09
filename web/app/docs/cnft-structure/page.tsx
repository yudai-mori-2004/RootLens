import { getTranslations } from "next-intl/server";
import s from "../../../components/docs/docs.module.css";
import DocsNav from "../../../components/docs/DocsNav";

export const metadata = { title: "cNFT Structure" };

export default async function CnftStructurePage() {
  const t = await getTranslations("docs.cnftStructure");
  const tn = await getTranslations("docs.nav");
  const ts = await getTranslations("docs.sidebar");

  return (
    <article className={s.article}>
      <h1 className={s.title}>{t("title")}</h1>
      <p className={s.subtitle}>{t("subtitle")}</p>

      <h2 className={s.h2}>{t("overviewTitle")}</h2>
      <ul className={s.tree}>
        <li>
          <span className={s.treeLabel}>content_hash</span>
          <ul>
            <li>
              <span className={s.treeLabel}>Core cNFT</span>
              <span className={s.treeSub}>{t("overviewCoreSub")}</span>
            </li>
            <li>
              <span className={s.treeLabel}>cert-* Extension</span>
              <span className={s.treeSub}>{t("overviewCertSub")}</span>
            </li>
            <li>
              <span className={s.treeLabel}>image-pdq Extension</span>
              <span className={s.treeSub}>{t("overviewPdqSub")}</span>
            </li>
            <li>
              <span className={s.treeLabel}>video-vpdq Extension</span>
              <span className={s.treeSub}>{t("overviewVpdqSub")}</span>
            </li>
          </ul>
        </li>
      </ul>

      {/* ---- Core cNFT ---- */}
      <h2 className={s.h2}>{t("coreTitle")}</h2>
      <p className={s.p}>{t("coreP1")}</p>

      <h3 className={s.h3}>{t("onchainTitle")}</h3>
      <p className={s.p}>{t("onchainIntro")}</p>
      <table className={s.table}>
        <thead><tr><th>trait_type</th><th>{t("exampleHeader")}</th></tr></thead>
        <tbody>
          <tr><td><code className={s.code}>protocol</code></td><td><code className={s.code}>Title-v1</code></td></tr>
          <tr><td><code className={s.code}>content_hash</code></td><td><code className={s.code}>0x3a7f...</code></td></tr>
          <tr><td><code className={s.code}>content_type</code></td><td><code className={s.code}>image/jpeg</code></td></tr>
        </tbody>
      </table>

      <h3 className={s.h3}>{t("payloadTitle")}</h3>
      <p className={s.p}>{t("payloadIntro")}</p>
      <table className={s.table}>
        <thead><tr><th>{t("fieldHeader")}</th><th>{t("typeHeader")}</th><th>{t("descHeader")}</th></tr></thead>
        <tbody>
          <tr><td><code className={s.code}>content_hash</code></td><td>string</td><td>{t("coreContentHash")}</td></tr>
          <tr><td><code className={s.code}>content_type</code></td><td>string</td><td>{t("coreContentType")}</td></tr>
          <tr><td><code className={s.code}>creator_wallet</code></td><td>string</td><td>{t("coreCreatorWallet")}</td></tr>
          <tr><td><code className={s.code}>nodes[]</code></td><td>array</td><td>{t("coreNodes")}</td></tr>
          <tr><td><code className={s.code}>links[]</code></td><td>array</td><td>{t("coreLinks")}</td></tr>
          <tr><td><code className={s.code}>tsa_timestamp</code></td><td>number?</td><td>{t("coreTsa")}</td></tr>
          <tr><td><code className={s.code}>tsa_pubkey_hash</code></td><td>string?</td><td>{t("coreTsaPubkey")}</td></tr>
          <tr><td><code className={s.code}>tsa_token_data</code></td><td>string?</td><td>{t("coreTsaToken")}</td></tr>
        </tbody>
      </table>

      <h3 className={s.h3}>{t("checksTitle")}</h3>
      <ul className={s.list}>
        {(["checkCollection", "checkTeeSig", "checkBinding", "checkProvenance", "checkOriginality"] as const).map((k) => (
          <li key={k}><span className={s.strong}>{t(`${k}Label` as any)}</span> — {t(`${k}Text` as any)}</li>
        ))}
      </ul>

      {/* ---- Extension cNFTs (shared structure) ---- */}
      <h2 className={s.h2}>{t("extTitle")}</h2>
      <p className={s.p}>{t("extP1")}</p>

      <h3 className={s.h3}>{t("onchainTitle")}</h3>
      <table className={s.table}>
        <thead><tr><th>trait_type</th><th>{t("exampleHeader")}</th></tr></thead>
        <tbody>
          <tr><td><code className={s.code}>protocol</code></td><td><code className={s.code}>Title-Extension-v1</code></td></tr>
          <tr><td><code className={s.code}>content_hash</code></td><td><code className={s.code}>0x3a7f...</code></td></tr>
          <tr><td><code className={s.code}>extension_id</code></td><td><code className={s.code}>image-pdq</code></td></tr>
        </tbody>
      </table>

      <h3 className={s.h3}>{t("payloadTitle")}</h3>
      <p className={s.p}>{t("extPayloadIntro")}</p>
      <table className={s.table}>
        <thead><tr><th>{t("fieldHeader")}</th><th>{t("typeHeader")}</th><th>{t("descHeader")}</th></tr></thead>
        <tbody>
          <tr><td><code className={s.code}>content_hash</code></td><td>string</td><td>{t("extContentHash")}</td></tr>
          <tr><td><code className={s.code}>content_type</code></td><td>string</td><td>{t("extContentType")}</td></tr>
          <tr><td><code className={s.code}>creator_wallet</code></td><td>string</td><td>{t("extCreatorWallet")}</td></tr>
          <tr><td><code className={s.code}>extension_id</code></td><td>string</td><td>{t("extExtId")}</td></tr>
          <tr><td><code className={s.code}>wasm_source</code></td><td>string</td><td>{t("extWasmSource")}</td></tr>
          <tr><td><code className={s.code}>wasm_hash</code></td><td>string</td><td>{t("extWasmHash")}</td></tr>
          <tr><td><code className={s.code}>extension_input_hash</code></td><td>string?</td><td>{t("extInputHash")}</td></tr>
          <tr><td className={s.strong}>{t("extResultLabel")}</td><td></td><td>{t("extResultDesc")}</td></tr>
        </tbody>
      </table>

      {/* ---- cert-* specifics ---- */}
      <h2 className={s.h2}>{t("certTitle")}</h2>
      <p className={s.p}>{t("certP1")}</p>
      <ul className={s.list}>
        <li><code className={s.code}>cert-google</code> — {t("certGoogle")}</li>
        <li><code className={s.code}>cert-sony</code> — {t("certSony")}</li>
        <li><code className={s.code}>cert-leica</code> — {t("certLeica")}</li>
        <li><code className={s.code}>cert-rootlens</code> — {t("certRootlens")}</li>
      </ul>
      <p className={s.p}>{t("certResultDesc")}</p>

      {/* ---- image-pdq ---- */}
      <h2 className={s.h2}>{t("pdqTitle")}</h2>
      <p className={s.p}>{t("pdqP1")}</p>
      <p className={s.p}>{t("pdqResultDesc")}</p>

      <h3 className={s.h3}>{t("pdqHowTitle")}</h3>
      <p className={s.p}>{t("pdqHowP1")}</p>

      <h3 className={s.h3}>{t("pdqVerifyTitle")}</h3>
      <p className={s.p}>
        {t("pdqVerifyP1before")}
        <span className={s.strong}>{t("pdqVerifyP1bold")}</span>
        {t("pdqVerifyP1after")}
      </p>

      {/* ---- video-vpdq ---- */}
      <h2 className={s.h2}>{t("vpdqTitle")}</h2>
      <p className={s.p}>{t("vpdqP1")}</p>
      <p className={s.p}>{t("vpdqResultDesc")}</p>

      <h3 className={s.h3}>{t("pdqVerifyTitle")}</h3>
      <p className={s.p}>{t("vpdqVerifyP1")}</p>

      {/* ---- Verification checks (shared) ---- */}
      <h2 className={s.h2}>{t("extChecksTitle")}</h2>
      <ul className={s.list}>
        {(["checkExtCollection", "checkTeeSig", "checkBinding", "checkWasm"] as const).map((k) => (
          <li key={k}><span className={s.strong}>{t(`${k}Label` as any)}</span> — {t(`${k}Text` as any)}</li>
        ))}
      </ul>

      <DocsNav
        prev={{ href: "/docs/title-protocol", title: ts("titleProtocol") }}
        next={{ href: "/docs/verification", title: ts("clientSideVerification") }}
        prevLabel={tn("prev")}
        nextLabel={tn("next")}
      />
    </article>
  );
}

import { getTranslations } from "next-intl/server";
import s from "../../../components/docs/docs.module.css";
import DocsNav from "../../../components/docs/DocsNav";

export const metadata = { title: "Trust Model" };

export default async function TrustModelPage() {
  const t = await getTranslations("docs.trustModel");
  const tn = await getTranslations("docs.nav");
  const ts = await getTranslations("docs.sidebar");

  const LAYERS = [
    { name: "DeviceTee", label: t("layerDeviceTee") },
    { name: "TpTee", label: t("layerTpTee") },
    { name: "GlobalConfig", label: t("layerGlobalConfig") },
    { name: "Solana", label: t("layerSolana") },
    { name: "Rpc", label: t("layerRpc") },
    { name: "Storage", label: t("layerStorage") },
    { name: "Indexer", label: t("layerIndexer") },
  ] as const;

  return (
    <article className={s.article}>
      <h1 className={s.title}>{t("title")}</h1>
      <p className={s.subtitle}>{t("subtitle")}</p>

      {/* Where Does Trust Come From? */}
      <h2 className={s.h2}>{t("originTitle")}</h2>
      <p className={s.p}>
        {t.rich("originP1", {
          teeHardware: (c) => <span className={s.strong}>{c}</span>,
        })}
      </p>
      <p className={s.p}>
        {t.rich("originP2", {
          nobodyCanExtract: (c) => <span className={s.strong}>{c}</span>,
        })}
      </p>
      <p className={s.p}>
        {t.rich("originP3", {
          signedJson: () => <code className={s.code}>signed_json</code>,
        })}
      </p>

      {/* What You Must Trust */}
      <h2 className={s.h2}>{t("mustTrustTitle")}</h2>
      <p className={s.p}>
        {t.rich("mustTrustP1", {
          teeWorking: (c) => <span className={s.strong}>{c}</span>,
        })}
      </p>
      <p className={s.p}>
        {t.rich("mustTrustP2", {
          rules: (c) => <span className={s.strong}>{c}</span>,
          globalConfig: () => <code className={s.code}>GlobalConfig</code>,
        })}
      </p>
      <p className={s.p}>{t("mustTrustP3")}</p>
      <p className={s.p}>
        {t.rich("mustTrustP4", {
          openSource: (c) => <span className={s.strong}>{c}</span>,
        })}
      </p>

      {/* Trust Layers */}
      <h2 className={s.h2}>{t("layersTitle")}</h2>
      <p className={s.p}>
        {t.rich("layersIntro", {
          doNotNeedTrust: (c) => <span className={s.strong}>{c}</span>,
        })}
      </p>

      <table className={s.table}>
        <thead>
          <tr>
            <th>{t("layerHeader")}</th>
            <th>{t("layerTrustHeader")}</th>
            <th>{t("layerWhyHeader")}</th>
            <th>{t("layerCompromisedHeader")}</th>
          </tr>
        </thead>
        <tbody>
          {LAYERS.map(({ name, label }) => (
            <tr key={name}>
              <td><span className={s.strong}>{label}</span></td>
              <td>{t(`layer${name}Trust` as any)}</td>
              <td>{t(`layer${name}Why` as any)}</td>
              <td>{t(`layer${name}Compromised` as any)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* The Server Question */}
      <h2 className={s.h2}>{t("serverTitle")}</h2>
      <p className={s.p}>{t("serverIntro")}</p>
      <ul className={s.list}>
        <li>
          {t.rich("serverRouting", {
            label: (c) => <span className={s.strong}>{c}</span>,
            link: () => <code className={s.code}>rootlens.io/p/abc123</code>,
            contentHash: () => <code className={s.code}>content_hash</code>,
          })}
        </li>
        <li>
          {t.rich("serverIndexer", {
            label: (c) => <span className={s.strong}>{c}</span>,
            contentHash: () => <code className={s.code}>content_hash</code>,
          })}
        </li>
      </ul>
      <p className={s.p}>
        {t.rich("serverAttackIntro", {
          contentHash: () => <code className={s.code}>content_hash</code>,
        })}
      </p>
      <ul className={s.list}>
        <li>
          {t.rich("serverDefensePdq", {
            label: (c) => <span className={s.strong}>{c}</span>,
          })}
        </li>
        <li>
          {t.rich("serverDefenseBinding", {
            label: (c) => <span className={s.strong}>{c}</span>,
            contentHash: () => <code className={s.code}>content_hash</code>,
            contentHash2: () => <code className={s.code}>content_hash</code>,
          })}
        </li>
      </ul>
      <p className={s.p}>{t("serverConclusion")}</p>

      {/* TEE Attestation */}
      <h2 className={s.h2}>{t("attestationTitle")}</h2>
      <p className={s.p}>{t("attestationIntro")}</p>
      <ul className={s.list}>
        <li>
          {t.rich("attestationCollection", {
            label: (c) => <span className={s.strong}>{c}</span>,
          })}
        </li>
        <li>
          {t.rich("attestationData", {
            label: (c) => <span className={s.strong}>{c}</span>,
            signedJson: () => <code className={s.code}>signed_json</code>,
          })}
        </li>
      </ul>
      <p className={s.p}>{t("attestationConclusion")}</p>

      {/* Self-Proving Data */}
      <h2 className={s.h2}>{t("selfProvingTitle")}</h2>
      <p className={s.p}>
        {t.rich("selfProvingP1", {
          signedJson: () => <code className={s.code}>signed_json</code>,
          selfProving: (c) => <span className={s.strong}>{c}</span>,
        })}
      </p>
      <p className={s.p}>{t("selfProvingP2")}</p>

      {/* GlobalConfig */}
      <h2 className={s.h2}>{t("globalConfigTitle")}</h2>
      <p className={s.p}>{t("globalConfigP1")}</p>
      <ul className={s.list}>
        <li>{t("globalConfigItem1")}</li>
        <li>{t("globalConfigItem2")}</li>
        <li>{t("globalConfigItem3")}</li>
      </ul>
      <p className={s.p}>{t("globalConfigP2")}</p>

      <div className={s.callout}>
        <div className={s.calloutLabel}>{t("honestLabel")}</div>
        {t("honestText")}
      </div>

      <DocsNav
        prev={{ href: "/docs", title: ts("overview") }}
        next={{ href: "/docs/content-origins", title: ts("howContentIsSigned") }}
        prevLabel={tn("prev")}
        nextLabel={tn("next")}
      />
    </article>
  );
}

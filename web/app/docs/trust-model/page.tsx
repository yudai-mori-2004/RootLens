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
        {t("originP1before")}
        <span className={s.strong}>{t("originP1bold")}</span>
        {t("originP1after")}
      </p>
      <p className={s.p}>
        {t("originP2before")}
        <span className={s.strong}>{t("originP2bold")}</span>
        {t("originP2after")}
      </p>
      <p className={s.p}>
        {t("originP3before")}
        <code className={s.code}>{t("originP3code")}</code>
        {t("originP3after")}
      </p>

      {/* What You Must Trust */}
      <h2 className={s.h2}>{t("mustTrustTitle")}</h2>
      <p className={s.p}>
        {t("mustTrustP1before")}
        <span className={s.strong}>{t("mustTrustP1bold")}</span>
        {t("mustTrustP1after")}
      </p>
      <p className={s.p}>
        {t("mustTrustP2a")}
        <span className={s.strong}>{t("mustTrustP2rulesBold")}</span>
        {t("mustTrustP2b")}
        <code className={s.code}>{t("mustTrustP2gcCode")}</code>
        {t("mustTrustP2c")}
      </p>
      <p className={s.p}>{t("mustTrustP3")}</p>
      <p className={s.p}>
        {t("mustTrustP4before")}
        <span className={s.strong}>{t("mustTrustP4bold")}</span>
        {t("mustTrustP4after")}
      </p>

      {/* Trust Layers */}
      <h2 className={s.h2}>{t("layersTitle")}</h2>
      <p className={s.p}>
        {t("layersIntroBefore")}
        <span className={s.strong}>{t("layersIntroBold")}</span>
        {t("layersIntroAfter")}
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
          <span className={s.strong}>{t("serverRoutingLabel")}</span>
          {" "}{t("serverRoutingText")}
          <code className={s.code}>{t("serverRoutingLink")}</code>
          {t("serverRoutingText2")}
          <code className={s.code}>{t("serverRoutingCode")}</code>
          {t("serverRoutingText3")}
        </li>
        <li>
          <span className={s.strong}>{t("serverIndexerLabel")}</span>
          {" "}{t("serverIndexerText")}
          <code className={s.code}>{t("serverIndexerCode")}</code>
          {t("serverIndexerText2")}
        </li>
      </ul>
      <p className={s.p}>
        {t("serverAttackBefore")}
        <code className={s.code}>{t("serverAttackCode")}</code>
        {t("serverAttackAfter")}
      </p>
      <ul className={s.list}>
        <li>
          <span className={s.strong}>{t("serverDefensePdqLabel")}</span>
          {" "}{t("serverDefensePdqText")}
        </li>
        <li>
          <span className={s.strong}>{t("serverDefenseBindingLabel")}</span>
          {" "}{t("serverDefenseBindingText")}
          <code className={s.code}>{t("serverDefenseBindingCode")}</code>
          {t("serverDefenseBindingText2")}
          <code className={s.code}>{t("serverDefenseBindingCode2")}</code>
          {t("serverDefenseBindingText3")}
        </li>
      </ul>
      <p className={s.p}>{t("serverConclusion")}</p>

      {/* TEE Attestation */}
      <h2 className={s.h2}>{t("attestationTitle")}</h2>
      <p className={s.p}>{t("attestationIntro")}</p>
      <ul className={s.list}>
        <li>
          <span className={s.strong}>{t("attestationCollectionLabel")}</span>
          {" "}{t("attestationCollectionText")}
        </li>
        <li>
          <span className={s.strong}>{t("attestationDataLabel")}</span>
          {" "}{t("attestationDataText")}
          <code className={s.code}>{t("attestationDataCode")}</code>
          {t("attestationDataText2")}
        </li>
      </ul>
      <p className={s.p}>{t("attestationConclusion")}</p>

      {/* Self-Proving Data */}
      <h2 className={s.h2}>{t("selfProvingTitle")}</h2>
      <p className={s.p}>
        {t("selfProvingP1a")}
        <code className={s.code}>{t("selfProvingP1code")}</code>
        {t("selfProvingP1b")}
        <span className={s.strong}>{t("selfProvingP1bold")}</span>
        {t("selfProvingP1c")}
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

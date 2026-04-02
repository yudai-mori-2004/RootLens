"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type {
  PageMeta,
  ContentRecord,
} from "@/lib/types";
import type { VerificationResult, ProcessorVerification, CheckResult } from "@/lib/verify/checks/types";
import type { ResolvedContent, ExtensionNft } from "@/lib/verify/content-resolver";
import type { CorePayload, ExtensionPayload, GraphNode, SignedJson } from "@title-protocol/sdk";
import { fetchContentRecord, verifyContent } from "@/lib/data";
import { PDQ_THRESHOLD, getProtocolAddresses, getGlobalConfigData, type GlobalConfigData } from "@/lib/verify/config";
import styles from "./ContentPage.module.css";

interface Props {
  page: PageMeta;
}

export default function ContentPage({ page }: Props) {
  const t = useTranslations("content");
  const tField = useTranslations("field");
  const tFooter = useTranslations("footer");
  const [activeIndex, setActiveIndex] = useState(0);
  const [records, setRecords] = useState<(ContentRecord | null)[]>([]);
  const [resolvedList, setResolvedList] = useState<(ResolvedContent | null)[]>([]);
  const [verifications, setVerifications] = useState<VerificationResult[]>([]);
  const [techOpen, setTechOpen] = useState(false);
  const [protocolAddr] = useState(() => getProtocolAddresses());
  const [globalConfig, setGlobalConfig] = useState<GlobalConfigData | null>(null);

  useEffect(() => {
    getGlobalConfigData().then(setGlobalConfig);
  }, []);

  useEffect(() => {
    const n = page.contents.length;

    // ヘッダー (コンテンツ別の詳細ログは verify.ts 内で出力)
    console.log(
      "%c RootLens Verification ",
      "background:#1E3A5F;color:#fff;padding:8px 16px;font-size:16px;font-weight:bold;border-radius:4px;",
    );
    console.log(
      `%c${n} content${n > 1 ? "s" : ""} \u00b7 All steps performed client-side. No RootLens server involved.`,
      "color:#888;font-style:italic;",
    );

    // 全コンテンツを並列取得・検証
    Promise.all(
      page.contents.map(async (c) => {
        const { record: r, resolved: res } = await fetchContentRecord(c.contentHash);
        const isVideo = c.mediaType === "video";
        const v = await verifyContent(
          c.contentHash,
          {
            imageUrl: isVideo ? undefined : c.thumbnailUrl,
            videoUrl: isVideo ? c.mediaUrl : undefined,
          },
          res,
        );
        return { record: r, resolved: res, verification: v };
      })
    ).then((results) => {
      setRecords(results.map((r) => r.record));
      setResolvedList(results.map((r) => r.resolved));
      setVerifications(results.map((r) => r.verification));

      // フッター
      const passed = results.filter((r) => r.verification.overall === "verified").length;
      const allOk = passed === n;
      console.log(
        allOk ? `%c \u2713 ALL CONTENTS: ${passed}/${n} verified ` : `%c \u2717 ${passed}/${n} verified `,
        allOk
          ? "background:#16a34a;color:#fff;padding:6px 14px;font-size:14px;font-weight:bold;border-radius:4px;"
          : "background:#dc2626;color:#fff;padding:6px 14px;font-size:14px;font-weight:bold;border-radius:4px;",
      );
    });
  }, [page.contents]);

  // 現在表示中のコンテンツ
  const currentContent = page.contents[activeIndex];
  const record = records[activeIndex] ?? null;
  const resolved = resolvedList[activeIndex] ?? null;
  const verification = verifications[activeIndex] ?? {
    processors: [],
    overall: "pending" as const,
  };

  // Core payload
  const corePayload = resolved?.coreSignedJson?.payload as CorePayload | undefined;
  const coreSj = resolved?.coreSignedJson ?? null;

  // 日付ソース
  const hasTsa = corePayload?.tsa_timestamp != null;
  const capturedDate = hasTsa
    ? formatTimestamp(corePayload!.tsa_timestamp!)
    : record?.capturedAt ? formatDate(record.capturedAt) : null;

  // ヘルパー
  const findProc = (id: string) => verification.processors.find(p => p.processorId === id);
  const coreProc = findProc("core-c2pa");

  // スコア — 全 processor の全チェックから算出
  const allChecks: CheckResult[] = verification.processors.flatMap(p => [...p.common, ...p.specific]);
  const passed = allChecks.filter(c => c.status === "verified").length;
  const total = allChecks.length;

  // クリエイターページURL
  const creatorHref = page.user
    ? page.user.username ? `/@${page.user.username}` : `/${page.user.address}`
    : null;

  return (
    <div className={styles.container}>
      {/* Image */}
      <div className={styles.imageWrapper}>
        {currentContent?.mediaType === 'video' && currentContent.mediaUrl ? (
          <video
            src={currentContent.mediaUrl}
            poster={currentContent.thumbnailUrl}
            controls
            playsInline
            className={styles.heroImage}
            crossOrigin="anonymous"
          />
        ) : (
          <img src={currentContent?.thumbnailUrl} alt="" className={styles.heroImage} crossOrigin="anonymous" />
        )}
        {page.contents.length > 1 && (
          <>
            <button
              className={`${styles.navArrow} ${styles.navArrowLeft}`}
              onClick={() => setActiveIndex((activeIndex - 1 + page.contents.length) % page.contents.length)}
              aria-label="Previous"
            >
              <svg width="20" height="20" viewBox="0 0 20 20"><path d="M12 4l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <button
              className={`${styles.navArrow} ${styles.navArrowRight}`}
              onClick={() => setActiveIndex((activeIndex + 1) % page.contents.length)}
              aria-label="Next"
            >
              <svg width="20" height="20" viewBox="0 0 20 20"><path d="M8 4l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <div className={styles.pageCounter}>
              {activeIndex + 1} / {page.contents.length}
            </div>
          </>
        )}
      </div>

      {/* ===== Below image ===== */}

      {/* 1. Date/time + chip */}
      <div className={styles.dateRow}>
        {capturedDate ? (
          <>
            <time className={styles.dateTime} dateTime={record?.capturedAt || undefined}>
              {capturedDate}
            </time>
            <span className={hasTsa ? styles.chipRegistered : styles.chipShot}>
              {hasTsa ? t("chip.registered") : t("chip.shot")}
            </span>
          </>
        ) : (
          <div className={styles.infoSkeleton}>
            <div className={styles.skeletonLine} style={{ width: "40%", height: 13 }} />
          </div>
        )}
      </div>

      {/* 2. Caption */}
      {page.caption && (
        <CaptionBlock
          caption={page.caption}
          seeMore={t("caption.seeMore")}
          seeLess={t("caption.seeLess")}
        />
      )}

      {/* 3. Creator */}
      {page.user && creatorHref && (
        <a href={creatorHref} className={styles.creatorRow}>
          {page.user.avatarUrl ? (
            <img src={page.user.avatarUrl} alt="" className={styles.creatorAvatar} />
          ) : (
            <div className={styles.creatorAvatarPlaceholder}>
              {page.user.displayName ? page.user.displayName.charAt(0).toUpperCase() : "?"}
            </div>
          )}
          <span className={styles.creatorName}>
            {page.user.displayName || truncate(page.user.address, 4)}
          </span>
        </a>
      )}

      {/* 4. Trust row */}
      <div className={styles.trustSection}>
        <div className={styles.trustRow}>
          {verification.overall === "pending" ? (
            <>
              <LoadingDots />
              <span className={styles.trustPending}>{t("trust.verifying")}</span>
            </>
          ) : verification.overall === "verified" ? (
            <>
              <ShieldIcon verified />
              <span className={styles.trustVerified}>{t("trust.verified")}</span>
              <span className={styles.trustSep}>·</span>
              <span className={styles.trustScoreFrac}>{passed}/{total}</span>
            </>
          ) : (
            <>
              <ShieldIcon verified={false} />
              <span className={styles.trustFailed}>{t("trust.failed")}</span>
              <span className={styles.trustSep}>·</span>
              <span className={styles.trustScoreFrac}>{passed}/{total}</span>
            </>
          )}
        </div>
      </div>

      {/* ===== 技術者向け詳細 ===== */}
      <div className={styles.detailsSection}>
        <button
          className={styles.detailsToggle}
          onClick={() => setTechOpen(!techOpen)}
          aria-expanded={techOpen}
        >
          <span>{t("tech.toggle")}</span>
          <ChevronIcon open={techOpen} />
        </button>

        {techOpen && (
          <>
          {/* ===== Primary data ===== */}
          <div className={styles.primaryData}>
            {/* GlobalConfig (信頼の原点) */}
            <div className={styles.dataBlock}>
              <DataField label="program" value={truncate(protocolAddr.programId, 12)} full={protocolAddr.programId} />
              <DataField label="globalConfigPda" value={truncate(protocolAddr.globalConfigPda, 12)} full={protocolAddr.globalConfigPda} />
              <DataField label="network" value="Solana devnet" />
              {globalConfig && (
                <>
                  <DataField label="authority" value={truncate(globalConfig.authority, 12)} full={globalConfig.authority} />
                  <DataField label="coreCollection" value={truncate(globalConfig.core, 12)} full={globalConfig.core} />
                  <DataField label="extCollection" value={truncate(globalConfig.ext, 12)} full={globalConfig.ext} />
                  <DataField label="trustedTeeNodes" value={`${globalConfig.trustedTeeNodes.length}`} />
                  <DataField label="trustedTsaKeys" value={globalConfig.trustedTsaKeys.length > 0 ? `${globalConfig.trustedTsaKeys.length}` : tField("none")} />
                  <DataField label="trustedWasmModules" value={globalConfig.trustedWasmModules.map(m => m.extension_id).join(", ") || tField("none")} />
                </>
              )}
            </div>

            {/* Content-level (NFT-independent) */}
            <div className={styles.dataBlock}>
              <DataField label="content_hash" value={truncate(currentContent.contentHash, 16)} full={currentContent.contentHash} />
              <DataField label="content_type" value={corePayload?.content_type || record?.mediaType || ""} />
              {record?.signingAlgorithm && <DataField label="c2paSigning" value={record.signingAlgorithm} />}
              {record?.sourceDimensions && record.sourceDimensions.width > 0 && (
                <DataField label="dimensions" value={`${record.sourceDimensions.width} × ${record.sourceDimensions.height}`} />
              )}
              {record?.tsaProvider && (
                <DataField label="tsa_timestamp" value={`${record.tsaProvider}${record.tsaTimestamp ? ` (${formatDateShort(record.tsaTimestamp)})` : ""}`} />
              )}
              {corePayload?.nodes && (
                <DataField label="nodes" value={String(corePayload.nodes.length)} />
              )}
              {corePayload?.links !== undefined && (
                <DataField label="links" value={corePayload.links.length > 0 ? String(corePayload.links.length) : "0"} />
              )}
            </div>

            {/* Processor toggles — unified structure for Core and Extensions */}
            {verification.processors.map((proc, procIdx) => {
              const isCore = proc.processorId === "core-c2pa";
              const label = isCore ? `Core: C2PA` : `Extension: ${proc.processorId}`;

              // Resolve the NFT data source
              const sj = isCore
                ? resolved?.coreSignedJson
                : resolved?.extensionNfts.find(n => {
                    const p = n.signedJson.payload as Record<string, unknown>;
                    return p.extension_id === proc.processorId;
                  })?.signedJson;
              const extNft = !isCore ? resolved?.extensionNfts.find(n => {
                const p = n.signedJson.payload as Record<string, unknown>;
                return p.extension_id === proc.processorId;
              }) : undefined;
              const nftAssetId = isCore ? resolved?.assetId : extNft?.assetId;
              const nftArweaveUri = isCore ? resolved?.arweaveUri : extNft?.arweaveUri;
              const nftCollection = isCore ? resolved?.collectionAddress : extNft?.collectionAddress;
              const nftOwner = isCore ? resolved?.ownerWallet : extNft?.ownerWallet;
              const payloadEntries = !isCore && sj
                ? Object.entries(sj.payload as Record<string, unknown>)
                : [];

              // All checks flat: common 4 + specific N
              const checks = [...proc.common, ...proc.specific];

              return (
                <NftToggle key={proc.processorId + procIdx} label={label} defaultOpen={isCore}>
                  <div className={styles.verifyList}>
                    {checks.map((check, checkIdx) => (
                      <VerifyItem
                        key={checkIdx}
                        status={check.status}
                        label={check.id}
                        detail={check.detail || ""}
                      />
                    ))}
                  </div>

                  {/* Recorded data */}
                  <div className={styles.dataBlock}>
                    {nftCollection && <DataField label="collection" value={truncate(nftCollection, 16)} full={nftCollection} />}
                    {nftAssetId && <DataField label="assetId" value={truncate(nftAssetId, 16)} full={nftAssetId} />}
                    {nftArweaveUri && <DataField label="offchainUri" value={truncate(nftArweaveUri, 20)} full={nftArweaveUri} />}
                    {sj && (
                      <>
                        <DataField label="protocol" value={sj.protocol} />
                        <DataField label="tee_type" value={sj.tee_type || ""} />
                        <DataField label="teeSigning" value="Ed25519" />
                        <DataField label="tee_pubkey" value={truncate(sj.tee_pubkey, 16)} full={sj.tee_pubkey} />
                        <DataField label="tee_signature" value={truncate(sj.tee_signature, 16)} full={sj.tee_signature} />
                        {sj.tee_attestation && (
                          <DataField label="tee_attestation" value={truncate(sj.tee_attestation, 16)} full={sj.tee_attestation} />
                        )}
                      </>
                    )}
                    {nftOwner && <DataField label="owner" value={truncate(nftOwner, 12)} full={nftOwner} />}
                    {/* Core-specific fields */}
                    {isCore && corePayload && (
                      <>
                        <DataField label="creator_wallet" value={corePayload.creator_wallet ? truncate(corePayload.creator_wallet, 12) : "\u2014"} full={corePayload.creator_wallet} />
                        {(corePayload as unknown as Record<string, unknown>).tsa_pubkey_hash && (
                          <DataField label="tsa_pubkey_hash" value={truncate(String((corePayload as unknown as Record<string, unknown>).tsa_pubkey_hash), 16)} full={String((corePayload as unknown as Record<string, unknown>).tsa_pubkey_hash)} />
                        )}
                        {(corePayload as unknown as Record<string, unknown>).tsa_token_data && (
                          <DataField label="tsa_token_data" value={truncate(String((corePayload as unknown as Record<string, unknown>).tsa_token_data), 16)} full={String((corePayload as unknown as Record<string, unknown>).tsa_token_data)} />
                        )}
                      </>
                    )}
                    {/* Extension payload fields */}
                    {!isCore && payloadEntries.map(([k, v]) => {
                      const display = typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);
                      return (
                        <DataField key={k} label={k} value={truncate(display, 20)} full={display.length > 40 ? display : undefined} />
                      );
                    })}
                  </div>
                </NftToggle>
              );
            })}

            {/* Download */}
            <button
              className={styles.downloadButton}
              onClick={() => downloadVerificationData({
                contentHash: currentContent.contentHash,
                record,
                resolved,
                verification,
                coreSignedJson: coreSj,
                corePayload,
                protocolAddr,
                globalConfig,
              })}
            >
              {tField("download")}
            </button>
          </div>

          <div className={styles.techContent}>
            {/* --- 1. Title Protocol 導入 + このコンテンツの検証コンテキスト --- */}
            <section className={styles.techGroup}>
              <h3 className={styles.techGroupTitle}>{t("tech.intro.title")}</h3>
              <p className={styles.techDesc}>{t("tech.intro.desc")}</p>
              <p className={styles.techDesc}>{t("tech.intro.trustChain")}</p>
              <p className={styles.techDescSmall}>
                {t("tech.dyn.protocolContext", { program: truncate(protocolAddr.programId, 8), pda: truncate(protocolAddr.globalConfigPda, 8), network: "Solana devnet" })}
              </p>
            </section>

            {/* --- 2. Core NFT — このコンテンツの来歴 --- */}
            <section className={styles.techGroup}>
              <h3 className={styles.techGroupTitle}>{t("tech.core.title")}</h3>
              <p className={styles.techDesc}>{t("tech.core.desc")}</p>
              {coreSj && corePayload && (
                <>
                  <p className={styles.techDesc}>
                    {t("tech.dyn.coreSummary", {
                      hash: truncate(currentContent.contentHash, 10),
                      type: corePayload.content_type,
                      signing: record?.signingAlgorithm ? t("tech.dyn.coreSigning", { algo: record.signingAlgorithm }) : "",
                      nodes: String(corePayload.nodes?.length ?? 0),
                      links: corePayload.links && corePayload.links.length > 0 ? t("tech.dyn.coreLinks", { count: String(corePayload.links.length) }) : "",
                    })}
                  </p>
                  <p className={styles.techDesc}>
                    {t("tech.dyn.teeVerified", {
                      teeType: coreSj.tee_type,
                      pubkey: truncate(coreSj.tee_pubkey, 8),
                      uri: truncate(resolved?.arweaveUri ?? "", 16),
                      assetId: truncate(resolved?.assetId ?? "", 8),
                    })}
                  </p>
                  {record?.tsaProvider && (
                    <p className={styles.techDescSmall}>
                      {t("tech.dyn.tsaCertified", {
                        provider: record.tsaProvider,
                        time: record.tsaTimestamp ? formatDateShort(record.tsaTimestamp) : "",
                      })}
                    </p>
                  )}
                  <p className={styles.techDescSmall}>
                    {resolved?.ownerWallet && corePayload.creator_wallet === resolved.ownerWallet
                      ? t("tech.dyn.ownerSame", { wallet: truncate(corePayload.creator_wallet, 8) })
                      : resolved?.ownerWallet
                        ? t("tech.dyn.ownerTransferred", { creator: truncate(corePayload.creator_wallet, 8), owner: truncate(resolved.ownerWallet, 8) })
                        : t("tech.dyn.ownerSame", { wallet: truncate(corePayload.creator_wallet, 8) })}
                  </p>
                  <p className={styles.techDescSmall}>{t("tech.core.offchainDesc")}</p>
                </>
              )}
            </section>

            {/* --- 3. Extension NFT — このコンテンツの属性検証 --- */}
            <section className={styles.techGroup}>
              <h3 className={styles.techGroupTitle}>{t("tech.ext.title")}</h3>
              <p className={styles.techDesc}>{t("tech.ext.desc")}</p>

              {/* PDQ */}
              {(() => {
                const pdqNft = resolved?.extensionNfts.find(n => {
                  const p = n.signedJson.payload as Record<string, unknown>;
                  return p.extension_id === "image-pdq";
                });
                const pdqProc = findProc("image-pdq");
                const pdqCheck = pdqProc?.specific.find(s => s.id === "pdq_match");
                const pdqPayload = pdqNft?.signedJson.payload as Record<string, unknown> | undefined;

                return pdqNft ? (
                  <div className={styles.extBlock}>
                    <h5 className={styles.extTitle}>{t("tech.pdq.title")}</h5>
                    <p className={styles.techDescSmall}>{t("tech.pdq.desc")}</p>
                    {!!pdqPayload?.pdqhash && (
                      <p className={styles.techDesc}>
                        {t("tech.dyn.pdqResult", {
                          hash: String(pdqPayload.pdqhash),
                          detail: pdqCheck?.detail ?? "",
                          wasmHash: truncate(String(pdqPayload.wasm_hash ?? ""), 10),
                        })}
                      </p>
                    )}
                  </div>
                ) : null;
              })()}

              {/* Cert extensions */}
              {(() => {
                const certProc = verification.processors.find(p => p.processorId.startsWith("cert-"));
                const certCheck = certProc?.specific.find(s => s.id === "cert_verified");
                return certProc ? (
                  <div className={styles.extBlock}>
                    <h5 className={styles.extTitle}>{t("tech.hardware.titleDefault")}</h5>
                    <p className={styles.techDescSmall}>{t("tech.hardware.desc")}</p>
                    <p className={styles.techDesc}>
                      {certCheck?.detail ?? ""}
                    </p>
                  </div>
                ) : (
                  <div className={styles.extBlock}>
                    <h5 className={styles.extTitle}>{t("tech.hardware.titleDefault")}</h5>
                    <p className={styles.techDescSmall}>{t("tech.hardware.desc")}</p>
                    <div className={styles.wipBadge}>{t("tech.hardware.wip")}</div>
                  </div>
                );
              })()}
            </section>

            {/* --- 4. なぜ信頼できるのか — 実結果を交えて --- */}
            <section className={styles.techGroup}>
              <h3 className={styles.techGroupTitle}>{t("tech.why.title")}</h3>

              <div className={styles.whyItem}>
                <h4 className={styles.whyItemTitle}>{t("tech.why.trustless")}</h4>
                <p className={styles.techDesc}>{t("tech.why.trustlessDesc")}</p>
                {coreSj && (
                  <p className={styles.techDescSmall}>
                    {t("tech.dyn.teeSigResult", {
                      pubkey: truncate(coreSj.tee_pubkey, 8),
                      result: (coreProc?.common[1].status ?? "pending") === "verified" ? t("tech.dyn.teeSigValid") : t("tech.dyn.teeSigPending"),
                    })}
                  </p>
                )}
              </div>

              {record?.tsaProvider && (
                <div className={styles.whyItem}>
                  <h4 className={styles.whyItemTitle}>{t("tech.why.tsa")}</h4>
                  <p className={styles.techDesc}>{t("tech.why.tsaDesc")}</p>
                  <p className={styles.techDescSmall}>
                    {t("tech.dyn.tsaResult", {
                      provider: record.tsaProvider,
                      time: record.tsaTimestamp ? formatDateShort(record.tsaTimestamp) : "",
                    })}
                  </p>
                </div>
              )}

              <div className={styles.whyItem}>
                <h4 className={styles.whyItemTitle}>{t("tech.why.noServer")}</h4>
                <p className={styles.techDesc}>{t("tech.why.noServerDesc")}</p>
              </div>

              <div className={styles.whyItem}>
                <h4 className={styles.whyItemTitle}>{t("tech.why.oss")}</h4>
                <p className={styles.techDesc}>{t("tech.why.ossDesc")}</p>
                <div className={styles.ossLinks}>
                  <a href="https://github.com/yudai-mori-2004/title-protocol" target="_blank" rel="noopener noreferrer" className={styles.ossLink}>
                    Title Protocol <ExternalIcon />
                  </a>
                  <a href="https://github.com/yudai-mori-2004/root-lens" target="_blank" rel="noopener noreferrer" className={styles.ossLink}>
                    RootLens <ExternalIcon />
                  </a>
                </div>
              </div>
            </section>
          </div>
          </>
        )}
      </div>

      {/* Footer */}
      <footer className={styles.footer}>
        <div className={styles.footerBrand}>
          <span className={styles.footerLogo}>RootLens</span>
          <span className={styles.footerTagline}>{tFooter("tagline")}</span>
        </div>
        <a href="https://rootlens.io" className={styles.footerLink} target="_blank" rel="noopener noreferrer">
          rootlens.io
        </a>
      </footer>
    </div>
  );
}

// --- Sub-components ---

type VerifyStatus = "verified" | "failed" | "pending";

function VerifyItem({ status, label, detail }: { status: VerifyStatus; label: string; detail: string }) {
  return (
    <div className={styles.verifyItem}>
      <div className={styles.verifyItemHeader}>
        <StatusIcon status={status} size={16} />
        <span className={styles.verifyItemLabel}>{label}</span>
      </div>
      <p className={styles.verifyItemDetail}>{detail}</p>
    </div>
  );
}

function DataField({ label, value, full, mono }: { label: string; value: string; full?: string; mono?: boolean }) {
  const tF = useTranslations("field");
  const raw = full || value;
  const href = dataFieldHref(label, raw);
  // Use i18n label if a translation exists, otherwise show raw label
  const displayLabel = tF.has(label) ? tF(label) : label;
  return (
    <div className={styles.dataRow}>
      <span className={styles.dataLabel}>{displayLabel}</span>
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className={`${styles.dataValue} ${styles.dataLink} ${mono ? styles.mono : ""}`} title={raw}>{value}</a>
      ) : (
        <span className={`${styles.dataValue} ${mono ? styles.mono : ""}`} title={raw}>{value}</span>
      )}
    </div>
  );
}

/** Generate a link for known data field types */
function dataFieldHref(label: string, value: string): string | null {
  const l = label.toLowerCase();
  // Solana addresses (program, PDA, collections, assets, wallets, keys)
  const solanaLabels = ["program", "globalconfigpda", "corecollection", "extcollection", "collection", "tee_pubkey", "assetid", "creator_wallet", "currentowner"];
  if (solanaLabels.includes(l) || l.includes("wallet") || l.includes("owner") || l.includes("creator") || l.includes("asset")) {
    return solanaExplorerUrl(value);
  }
  // Arweave / HTTP URIs
  if (value.startsWith("https://") || value.startsWith("http://")) {
    return value;
  }
  if (value.startsWith("ar://")) {
    return `https://arweave.net/${value.slice(5)}`;
  }
  // Off-chain URI / WASM source
  if (l === "offchainuri" || l === "wasm_source") {
    if (value.startsWith("https://") || value.startsWith("ar://")) {
      return value.startsWith("ar://") ? `https://arweave.net/${value.slice(5)}` : value;
    }
  }
  return null;
}

function RefRow({ label, sub, value, mono, link, linkLabel }: {
  label: string; sub?: string; value: string; mono?: boolean; link?: string; linkLabel?: string;
}) {
  return (
    <div className={styles.refRow}>
      <div className={styles.refLabel}>
        <span>{label}</span>
        {sub && <span className={styles.refSub}>{sub}</span>}
      </div>
      <div className={styles.refValue}>
        <span className={`${styles.refValueText} ${mono ? styles.mono : ""}`}>{value}</span>
        {link && (
          <a href={link} target="_blank" rel="noopener noreferrer" className={styles.refLink}>
            {linkLabel} <ExternalIcon />
          </a>
        )}
      </div>
    </div>
  );
}

function StatusIcon({ status, size = 16 }: { status: VerifyStatus; size?: number }) {
  if (status === "pending") return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={styles.iconPending}>
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="12 26">
        <animateTransform attributeName="transform" type="rotate" from="0 8 8" to="360 8 8" dur="1s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
  if (status === "verified") return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={styles.iconVerified}>
      <path d="M3.5 8.5l3 3 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={styles.iconFailed}>
      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function CaptionBlock({ caption, seeMore, seeLess }: { caption: string; seeMore: string; seeLess: string }) {
  const [expanded, setExpanded] = useState(false);
  const LIMIT = 100;
  const isLong = caption.length > LIMIT;
  const text = !isLong || expanded ? caption : caption.slice(0, LIMIT) + "…";

  return (
    <div className={styles.captionBlock}>
      <span className={styles.captionText}>{text}</span>
      {isLong && (
        <button className={styles.captionToggle} onClick={() => setExpanded(!expanded)}>
          {expanded ? seeLess : seeMore}
        </button>
      )}
    </div>
  );
}

function NftToggle({ label, defaultOpen, children }: { label: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div className={styles.nftToggle}>
      <button className={styles.nftToggleHeader} onClick={() => setOpen(!open)}>
        <span>{label}</span>
        <ChevronIcon open={open} />
      </button>
      {open && <div className={styles.nftToggleContent}>{children}</div>}
    </div>
  );
}

function ShieldIcon({ verified }: { verified: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" className={verified ? styles.iconVerified : styles.iconFailed}>
      <path d="M11 2l7.5 3.2v5.3c0 5-3.3 8.2-7.5 9.5-4.2-1.3-7.5-4.5-7.5-9.5V5.2L11 2z" fill="none" stroke="currentColor" strokeWidth="1.5" />
      {verified
        ? <path d="M7.5 11.5l2.5 2.5 4.5-4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        : <path d="M8 8l6 6M14 8l-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      }
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`}>
      <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" style={{ display: "inline", verticalAlign: "middle" }}>
      <rect x="4" y="4" width="7" height="7" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 4V2.5A1.5 1.5 0 006.5 1H2.5A1.5 1.5 0 001 2.5v4A1.5 1.5 0 002.5 8H4" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" style={{ display: "inline", verticalAlign: "middle", marginLeft: 2 }}>
      <path d="M4 1h7v7M11 1L5 7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LoadingDots() {
  return <span className={styles.loadingDots}><span /><span /><span /></span>;
}

// --- Utilities ---

function nodeBreakdown(nodes: GraphNode[]): string {
  const finals = nodes.filter(n => n.type === "final").length;
  const ingredients = nodes.filter(n => n.type === "ingredient").length;
  if (nodes.length === 0) return "";
  return ` (final: ${finals}, ingredient: ${ingredients})`;
}

function truncate(s: string, len = 8): string {
  if (s.length <= len * 2 + 3) return s;
  return `${s.slice(0, len)}...${s.slice(-len)}`;
}

function arweaveHttpUrl(uri: string): string {
  if (uri.startsWith("ar://")) return `https://arweave.net/${uri.slice(5)}`;
  return uri;
}

function solanaExplorerUrl(address: string): string {
  return `https://explorer.solana.com/address/${address}?cluster=devnet`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

function formatDateShort(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

function formatTimestamp(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

function downloadVerificationData(data: {
  contentHash: string;
  record: ContentRecord | null;
  resolved: ResolvedContent | null;
  verification: VerificationResult;
  coreSignedJson: SignedJson | null;
  corePayload: CorePayload | undefined;
  protocolAddr: { programId: string; globalConfigPda: string };
  globalConfig: GlobalConfigData | null;
}) {
  // CSV 3列: Display Name, Spec Field Path, Value
  const rows: string[][] = [["Display Name", "Field Path", "Value"]];
  const add = (display: string, path: string, value: string | undefined | null) => {
    if (value != null) rows.push([display, path, value]);
  };

  // --- GlobalConfig ---
  rows.push(["# GlobalConfig", "", ""]);
  add("Program", "TITLE_CONFIG_PROGRAM_ID", data.protocolAddr.programId);
  add("GlobalConfig PDA", "PDA: seeds=[b\"global-config\"]", data.protocolAddr.globalConfigPda);
  add("Network", "", "Solana devnet");
  if (data.globalConfig) {
    add("Authority", "GlobalConfigAccount.authority", data.globalConfig.authority);
    add("Core Collection", "GlobalConfigAccount.core_collection_mint", data.globalConfig.core);
    add("Extension Collection", "GlobalConfigAccount.ext_collection_mint", data.globalConfig.ext);
    add("Trusted TEE Nodes", "GlobalConfigAccount.trusted_node_keys → TeeNodeAccount[]", String(data.globalConfig.trustedTeeNodes.length));
    for (const node of data.globalConfig.trustedTeeNodes) {
      add(`  TEE Node (${node.tee_type})`, "TeeNodeAccount.signing_pubkey", node.signing_pubkey);
    }
    add("Trusted TSA Keys", "GlobalConfigAccount.trusted_tsa_keys", data.globalConfig.trustedTsaKeys.length > 0 ? data.globalConfig.trustedTsaKeys.join(", ") : "(empty)");
    add("Trusted WASM Modules", "GlobalConfigAccount.trusted_wasm_ids → WasmModuleAccount[]", String(data.globalConfig.trustedWasmModules.length));
    for (const m of data.globalConfig.trustedWasmModules) {
      for (const v of m.versions) {
        add(`  ${m.extension_id} v${v.version}`, "WasmModuleAccount.versions[].wasm_hash", v.wasm_hash);
        add(`  ${m.extension_id} v${v.version} source`, "WasmModuleAccount.versions[].wasm_source", v.wasm_source);
        add(`  ${m.extension_id} v${v.version} status`, "WasmModuleAccount.versions[].status", v.status === 0 ? "active" : "deprecated");
      }
    }
  }
  add("PDQ Threshold", "PDQ_THRESHOLD (client constant)", String(PDQ_THRESHOLD));

  // --- Content ---
  rows.push(["# Content", "", ""]);
  add("Content Hash", "query content_hash = SHA-256(Active Manifest Signature)", data.contentHash);
  add("Content Type", "signed_json.payload.content_type", data.corePayload?.content_type);
  add("Dimensions", "cNFT attributes: source_dimensions", data.record?.sourceDimensions ? `${data.record.sourceDimensions.width}x${data.record.sourceDimensions.height}` : undefined);
  add("C2PA Signing", "cNFT attributes: signing_algorithm", data.record?.signingAlgorithm);
  add("Device", "cNFT attributes: device_name", data.record?.deviceName);
  add("TSA Provider", "signed_json.payload.tsa_pubkey_hash → provider", data.record?.tsaProvider);
  add("TSA Timestamp", "signed_json.payload.tsa_timestamp", data.record?.tsaTimestamp);
  add("Provenance Nodes", "signed_json.payload.nodes.length", data.corePayload?.nodes ? String(data.corePayload.nodes.length) : undefined);
  add("Provenance Links", "signed_json.payload.links.length", data.corePayload?.links ? String(data.corePayload.links.length) : undefined);

  // --- Verification Results ---
  rows.push(["# Verification Results", "", ""]);
  add("Overall", "§7.4 all steps aggregated", data.verification.overall);
  for (const proc of data.verification.processors) {
    rows.push([`## ${proc.processorId}`, "", ""]);
    for (const check of [...proc.common, ...proc.specific]) {
      add(check.id, "§7.4", `${check.status}${check.detail ? ` — ${check.detail}` : ""}`);
    }
  }

  // --- Core NFT Raw Data ---
  if (data.resolved) {
    rows.push(["# Core NFT (c2pa)", "", ""]);
    add("NFT Asset ID", "cNFT.id", data.resolved.assetId);
    add("Collection", "cNFT.collection.address", data.resolved.collectionAddress);
    add("Off-chain URI", "cNFT.content.json_uri", data.resolved.arweaveUri);
    add("Owner", "cNFT.owner", data.resolved.ownerWallet);
    if (data.coreSignedJson) {
      add("Protocol", "signed_json.protocol", data.coreSignedJson.protocol);
      add("TEE Type", "signed_json.tee_type", data.coreSignedJson.tee_type);
      add("TEE Public Key", "signed_json.tee_pubkey", data.coreSignedJson.tee_pubkey);
      add("TEE Signature", "signed_json.tee_signature", data.coreSignedJson.tee_signature);
      if (data.coreSignedJson.tee_attestation) {
        add("TEE Attestation", "signed_json.tee_attestation", data.coreSignedJson.tee_attestation);
      }
    }
    if (data.corePayload) {
      add("Registrant Wallet", "signed_json.payload.creator_wallet", data.corePayload.creator_wallet);
      const cp = data.corePayload as unknown as Record<string, unknown>;
      if (cp.tsa_pubkey_hash) {
        add("TSA Public Key Hash", "signed_json.payload.tsa_pubkey_hash", String(cp.tsa_pubkey_hash));
      }
      if (cp.tsa_token_data) {
        add("TSA Token", "signed_json.payload.tsa_token_data", String(cp.tsa_token_data));
      }
    }

    // --- Extension NFTs Raw Data ---
    for (const extNft of data.resolved.extensionNfts) {
      const p = extNft.signedJson.payload as Record<string, unknown>;
      const extId = (p.extension_id as string) || "unknown";
      rows.push([`# Extension NFT (${extId})`, "", ""]);
      add("NFT Asset ID", "cNFT.id", extNft.assetId);
      add("Collection", "cNFT.collection.address", extNft.collectionAddress);
      add("Off-chain URI", "cNFT.content.json_uri", extNft.arweaveUri);
      add("Owner", "cNFT.owner", extNft.ownerWallet);
      add("Protocol", "signed_json.protocol", extNft.signedJson.protocol);
      add("TEE Type", "signed_json.tee_type", extNft.signedJson.tee_type);
      add("TEE Public Key", "signed_json.tee_pubkey", extNft.signedJson.tee_pubkey);
      add("TEE Signature", "signed_json.tee_signature", extNft.signedJson.tee_signature);
      if (extNft.signedJson.tee_attestation) {
        add("TEE Attestation", "signed_json.tee_attestation", extNft.signedJson.tee_attestation);
      }
      add("Extension ID", "signed_json.payload.extension_id", extId);
      for (const [k, v] of Object.entries(p)) {
        if (!["extension_id", "content_hash", "protocol", "creator_wallet"].includes(k)) {
          add(k, `signed_json.payload.${k}`, typeof v === "object" && v !== null ? JSON.stringify(v) : String(v));
        }
      }
    }
  }

  // --- Metadata ---
  rows.push(["# Export Metadata", "", ""]);
  add("Generated", "", new Date().toISOString());
  add("Source", "", "https://github.com/yudai-mori-2004/title-protocol");

  const csv = rows.map(r => r.map(c => csvEscape(c)).join(",")).join("\n");
  const bom = "\uFEFF"; // UTF-8 BOM for Excel compatibility
  const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `rootlens-${data.contentHash.slice(0, 12)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

import { getTranslations } from "next-intl/server";
import s from "./lp.module.css";

// 構成 (= 思想の順に語る):
//   Hero      現場の仕事がロボットを教え、現場が対価を受け取る
//   §01       問題: ロボットの学習データは現場でしか生まれない
//   §02       モデル: データの価値を現場のメリットに変換して返す
//   §03       サービスカタログ (01 雇う現場向け / 02 企業向け。 増えたらブロックを足す)
//   §04       買い手向け: 収集デバイスとデータ仕様
//   §05       CTA
export default async function HomePage() {
  const tHero = await getTranslations("lp.hero");
  const tProblem = await getTranslations("lp.problem");
  const tModel = await getTranslations("lp.model");
  const tServices = await getTranslations("lp.services");
  const tFlow = await getTranslations("lp.appFlow");
  const tEnterprise = await getTranslations("lp.enterprise");
  const tDevices = await getTranslations("lp.devices");
  const tMath = await getTranslations("lp.math");
  const tHome = await getTranslations("pages.home");
  const t = await getTranslations("lp");

  const flowSteps = ["step1", "step2", "step3"] as const;
  const specRows = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9"] as const;

  // マーキー1周ぶん (= トラックに2周入れて -50% でシームレスにループ)
  const marqueeRun = Array.from({ length: 6 }, (_, i) => (
    <span key={i}>
      ROOTLENS <span aria-hidden="true">✦</span> {t("marquee")} <span aria-hidden="true">✦</span>
    </span>
  ));

  return (
    <div className={s.page}>
      {/* Hero */}
      <section className={s.hero}>
        <div className={s.heroInner}>
          <div className={s.heroMain}>
            <div className={s.heroEyebrow}>
              <span>RootLens</span>
              <span className={s.heroEyebrowDot}>·</span>
              <span className={s.heroEyebrowDesc}>{tHero("tagline")}</span>
            </div>
            <h1 className={s.heroTitle}>
              Real human work is<br />
              <span className={s.heroTitleAccent}>training data.</span>
            </h1>
            <p className={s.heroDescription}>{tHero("description")}</p>
            <div className={s.heroCtas}>
              <a href="#model" className={s.ctaPrimary}>
                {tHero("ctaModel")}
                <span aria-hidden="true">→</span>
              </a>
              <a href="/sample" className={s.ctaSecondary}>
                {tHero("ctaSample")}
                <span aria-hidden="true">→</span>
              </a>
            </div>
          </div>
          <aside className={s.heroMeta}>
            <div className={s.heroMetaLabel}>{tHero("metaFieldLabel")}</div>
            <div className={s.heroMetaValue}>{tHero("metaFieldValue")}</div>
            <div style={{ height: 12 }} />
            <div className={s.heroMetaLabel}>{tHero("metaStatusLabel")}</div>
            <div className={s.heroMetaValue}>{tHero("metaStatusValue")}</div>
            <div style={{ height: 12 }} />
            {/* 実績カウンタ。 売れはじめたら手で更新する (= 盛らない。 0 は 0 と書く) */}
            <div className={s.heroMetaLabel}>{tHero("metaCountLabel")}</div>
            <div className={s.heroMetaValue}>0 · 0</div>
          </aside>
        </div>
      </section>

      {/* マーキー帯 */}
      <div className={s.mq} aria-hidden="true">
        <div className={s.mqTrack}>
          {marqueeRun}
          {marqueeRun}
        </div>
      </div>

      {/* §01 問題 */}
      <section className={s.section}>
        <div className={s.sectionInner}>
          <header className={s.sectionHeader}>
            <div className={s.sectionNumber}>§01</div>
            <div>
              <div className={s.sectionLabel}>課題</div>
              <h2 className={s.sectionTitle}>{tProblem("title")}</h2>
            </div>
          </header>
          <div className={s.sectionBodyWithIllustration}>
            <div className={s.sectionBodyContentNarrow}>
              <p className={s.prose}>{tProblem("p1")}</p>
              <p className={s.prose}>{tProblem("p2")}</p>
              <p className={s.prose} style={{ marginTop: 28 }}>
                <span className={s.emphasis}>{tProblem("p3")}</span>
              </p>
            </div>
            <div className={s.sectionIllustration}>
              <img src="/lp/problem.webp" alt="" width={800} height={800} loading="lazy" />
            </div>
          </div>
        </div>
      </section>

      {/* §02 モデル */}
      <section className={s.section} id="model">
        <div className={s.sectionInner}>
          <header className={s.sectionHeader}>
            <div className={s.sectionNumber}>§02</div>
            <div>
              <div className={s.sectionLabel}>{tModel("label")}</div>
              <h2 className={s.sectionTitle}>{tModel("title")}</h2>
            </div>
          </header>
          <div className={s.sectionBody}>
            <p className={s.prose}>{tModel("p1")}</p>
            <p className={s.prose}>{tModel("p2")}</p>
            <p className={s.prose}>{tModel("p3")}</p>
            <p className={s.prose} style={{ marginTop: 28, marginBottom: 0 }}>
              <span className={s.emphasis}>{tModel("emphasis")}</span>
            </p>
          </div>
        </div>
      </section>

      {/* §03 サービスカタログ (= 還元の形。 増えたら serviceBlock を足す) */}
      <section className={s.section} id="services">
        <div className={s.sectionInner}>
          <header className={s.sectionHeader}>
            <div className={s.sectionNumber}>§03</div>
            <div>
              <h2 className={s.sectionTitle}>{tServices("title")}</h2>
            </div>
          </header>

          {/* サービス 01: アルバイトを雇う現場向け */}
          <div className={s.serviceBlock} id="for-stores">
            <div className={s.sectionLabel}>{tFlow("label")}</div>
            <h3 className={s.serviceTitle}>{tFlow("title")}</h3>
            <div className={s.sectionBody}>
              <div className={s.sectionBodyContent}>
                <p className={s.prose}>{tFlow("intro")}</p>
              </div>
            </div>
            <div className={s.steps} style={{ marginTop: 40 }}>
              {flowSteps.map((key, i) => {
                const icons = ["/lp/step-record.webp", "/lp/step-validate.webp", "/lp/step-earn.webp"];
                return (
                  <div key={key} className={s.step}>
                    <div className={s.stepIcon}>
                      <img src={icons[i]} alt="" width={400} height={400} loading="lazy" />
                    </div>
                    <div className={s.stepNumber}>0{i + 1} / 03</div>
                    <div className={s.stepLabel}>{tFlow(`${key}.label`)}</div>
                    <div className={s.stepText}>{tFlow(`${key}.text`)}</div>
                  </div>
                );
              })}
            </div>

            {/* 計算ストリップ (= フライヤーの白カード) */}
            <div className={s.mathStrip}>
              <div className={s.mathTag}>{tMath("tag")}</div>
              <div className={s.mathCell}>
                <div className={s.mathLb}>{tMath("wageLabel")}</div>
                <div className={s.mathVal}>
                  {tMath("wage")}
                  <span className={s.mathValUnit}>{tMath("wageUnit")}</span>
                </div>
              </div>
              <div className={s.mathOp}>−</div>
              <div className={`${s.mathCell} ${s.mathGive}`}>
                <div className={s.mathLb}>{tMath("feeLabel")}</div>
                <div className={s.mathVal}>
                  {tMath("fee")}
                  <span className={s.mathValUnit}>{tMath("feeUnit")}</span>
                </div>
              </div>
              <div className={s.mathOp}>=</div>
              <div className={`${s.mathCell} ${s.mathResult}`}>
                <div className={s.mathLb}>{tMath("resultLabel")}</div>
                <div className={s.mathVal}>
                  {tMath("result")}
                  <span className={s.mathValUnit}>{tMath("resultUnit")}</span>
                </div>
              </div>
            </div>
            <p className={s.mathNote}>{tMath("note")}</p>
          </div>

          {/* サービス 02: 企業向け現場診断 */}
          <div className={s.serviceBlock} id="for-companies">
            <div className={`${s.sectionLabel} ${s.serviceChipAlt}`}>{tEnterprise("label")}</div>
            <h3 className={s.serviceTitle}>{tEnterprise("title")}</h3>
            <div className={s.sectionBodyWithIllustration}>
              <div className={s.sectionBodyContentNarrow}>
                <p className={s.prose}>{tEnterprise("p1")}</p>
                <p className={s.prose}>{tEnterprise("p2")}</p>
                <div style={{ marginTop: 28 }}>
                  <a href="/contact" className={s.ctaSecondary}>
                    {tEnterprise("cta")}
                    <span aria-hidden="true">→</span>
                  </a>
                </div>
              </div>
              <div className={s.sectionIllustration}>
                <img src="/lp/step-validate.webp" alt="" width={800} height={800} loading="lazy" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* §04 買い手向け: 収集デバイスとデータ仕様 (= デバイスセット単位のラインナップ) */}
      <section className={s.section} id="specs">
        <div className={s.sectionInner}>
          <header className={s.sectionHeader}>
            <div className={s.sectionNumber}>§04</div>
            <div>
              <div className={s.sectionLabel}>{tDevices("label")}</div>
              <h2 className={s.sectionTitle}>{tDevices("title")}</h2>
            </div>
          </header>
          <div className={s.sectionBody}>
            <div className={s.sectionBodyContent}>
              <p className={s.prose}>{tDevices("intro1")}</p>
              <p className={s.prose}>{tDevices("intro2")}</p>
            </div>
          </div>
          <div className={s.rigGrid} style={{ marginTop: 40 }}>
            <div className={s.rigCard}>
              <div className={s.rigTag}>{tDevices("set01.tag")}</div>
              <div className={s.rigName}>{tDevices("set01.name")}</div>
              <p className={s.rigDesc}>{tDevices("set01.desc")}</p>
              <dl className={s.specList}>
                {specRows.map((row) => (
                  <div key={row} className={s.specRow}>
                    <dt className={s.specKey}>{tDevices(`set01.${row}k`)}</dt>
                    <dd className={s.specVal}>{tDevices(`set01.${row}v`)}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className={s.rigGhost}>
              <div className={s.rigTag}>{tDevices("set02.tag")}</div>
              <div className={s.rigName}>{tDevices("set02.name")}</div>
              <p className={s.rigDesc}>{tDevices("set02.desc")}</p>
            </div>
          </div>
        </div>
      </section>

      {/* マーキー帯 2 本目 */}
      <div className={`${s.mq} ${s.mqAlt}`} aria-hidden="true" style={{ marginTop: 72 }}>
        <div className={s.mqTrack}>
          {marqueeRun}
          {marqueeRun}
        </div>
      </div>

      {/* §05 Closing CTA */}
      <section className={s.closingCta}>
        <div className={s.closingCtaInner}>
          <div className={s.closingCtaVisual}>
            <img src="/lp/cta.webp" alt="" width={600} height={600} loading="lazy" />
          </div>
          <div className={s.closingCtaNumber}>§05</div>
          <div className={s.closingCtaMain}>
            <div className={s.closingCtaLabel}>Get in touch</div>
            <h2 className={s.closingCtaTitle}>{tHome("closingTitle")}</h2>
            <p className={s.closingCtaDesc}>{tHome("closingDesc")}</p>
          </div>
          <div className={s.closingCtaButtons}>
            <a href="/contact" className={s.ctaPrimary}>
              {tHome("ctaContact")}
              <span aria-hidden="true">→</span>
            </a>
            <a href="/sample" className={s.ctaSecondary}>
              {tHome("ctaSample")}
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}

import { getTranslations } from "next-intl/server";
import s from "./lp.module.css";

const CONTACT_EMAIL = "contact@rootlens.io";

// 構成 (= 思想の順に語る):
//   Hero      現場の仕事がロボットを教え、現場が対価を受け取る
//   §01       問題: ロボットの学習データは現場でしか生まれない
//   §02       モデル: データの価値を現場のメリットに変換して返す
//   §03       サービス 01 (お店向け): 併走スタッフ + 撮影協力費
//   §04       サービス 02 (企業向け): 無償の現場診断
//   §05       買い手向け: データの価値 4 条件
//   §06       CTA
export default async function HomePage() {
  const tHero = await getTranslations("lp.hero");
  const tProblem = await getTranslations("lp.problem");
  const tModel = await getTranslations("lp.model");
  const tFlow = await getTranslations("lp.appFlow");
  const tEnterprise = await getTranslations("lp.enterprise");
  const tIssues = await getTranslations("lp.issues");
  const tMath = await getTranslations("lp.math");
  const tHome = await getTranslations("pages.home");
  const t = await getTranslations("lp");

  const flowSteps = ["step1", "step2", "step3"] as const;
  const issues = ["hands", "sensors", "diversity", "consent"] as const;

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
        <div className={s.burst}>{tHero("burst")}</div>
        <div className={s.heroInner}>
          <div className={s.heroMain}>
            <div className={s.heroEyebrow}>
              <span>RootLens</span>
              <span className={s.heroEyebrowDot}>·</span>
              <span className={s.heroEyebrowDesc}>{tHero("tagline")}</span>
            </div>
            <h1 className={s.heroTitle}>
              Real work is<br />
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
            <div className={s.heroMetaLabel}>STATUS</div>
            <div className={s.heroMetaValue}>PILOT LIVE</div>
            <div style={{ height: 12 }} />
            <div className={s.heroMetaLabel}>DATA · NOW</div>
            <div className={s.heroMetaValue}>RGB · DEPTH · IMU · HANDS</div>
            <div style={{ height: 12 }} />
            <div className={s.heroMetaLabel}>DELIVERY</div>
            <div className={s.heroMetaValue}>MCAP</div>
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
              <div className={s.sectionLabel}>The problem</div>
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
            <p className={s.prose} style={{ marginTop: 28, marginBottom: 0 }}>
              <span className={s.emphasis}>{tModel("emphasis")}</span>
            </p>
          </div>
        </div>
      </section>

      {/* §03 サービス 01 (お店向け) */}
      <section className={s.section} id="for-stores">
        <div className={s.sectionInner}>
          <header className={s.sectionHeader}>
            <div className={s.sectionNumber}>§03</div>
            <div>
              <div className={s.sectionLabel}>{tFlow("label")}</div>
              <h2 className={s.sectionTitle}>{tFlow("title")}</h2>
            </div>
          </header>
          <div className={s.steps}>
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
      </section>

      {/* §04 サービス 02 (企業向け) */}
      <section className={s.section} id="for-companies">
        <div className={s.sectionInner}>
          <header className={s.sectionHeader}>
            <div className={s.sectionNumber}>§04</div>
            <div>
              <div className={s.sectionLabel}>{tEnterprise("label")}</div>
              <h2 className={s.sectionTitle}>{tEnterprise("title")}</h2>
            </div>
          </header>
          <div className={s.sectionBodyWithIllustration}>
            <div className={s.sectionBodyContentNarrow}>
              <p className={s.prose}>{tEnterprise("p1")}</p>
              <p className={s.prose}>{tEnterprise("p2")}</p>
              <div style={{ marginTop: 28 }}>
                <a href={`mailto:${CONTACT_EMAIL}`} className={s.ctaSecondary}>
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
      </section>

      {/* §05 買い手向け: データの価値 */}
      <section className={s.section}>
        <div className={s.sectionInner}>
          <header className={s.sectionHeader}>
            <div className={s.sectionNumber}>§05</div>
            <div>
              <div className={s.sectionLabel}>What buyers want</div>
              <h2 className={s.sectionTitle}>{tIssues("title")}</h2>
            </div>
          </header>
          <div className={s.sectionBody}>
            <div className={s.sectionBodyContent}>
              <p className={s.prose}>{tIssues("intro1")}</p>
              <p className={s.prose}>{tIssues("intro2")}</p>
              <p className={s.prose} style={{ marginTop: 28, marginBottom: 0 }}>
                <span className={s.emphasis}>{tIssues("pillarsLead")}</span>
              </p>
            </div>
          </div>
          <div className={s.issuesGrid} style={{ marginTop: 40 }}>
            {issues.map((key) => (
              <div key={key} className={s.issueItem}>
                <div className={s.issueLabel}>{tIssues(`${key}.label`)}</div>
                <div className={s.issueText}>{tIssues(`${key}.text`)}</div>
              </div>
            ))}
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

      {/* §06 Closing CTA */}
      <section className={s.closingCta}>
        <div className={s.closingCtaInner}>
          <div className={s.closingCtaVisual}>
            <img src="/lp/cta.webp" alt="" width={600} height={600} loading="lazy" />
          </div>
          <div className={s.closingCtaNumber}>§06</div>
          <div className={s.closingCtaMain}>
            <div className={s.closingCtaLabel}>Get in touch</div>
            <h2 className={s.closingCtaTitle}>{tHome("closingTitle")}</h2>
            <p className={s.closingCtaDesc}>{tHome("closingDesc")}</p>
          </div>
          <div className={s.closingCtaButtons}>
            <a href={`mailto:${CONTACT_EMAIL}`} className={s.ctaPrimary}>
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

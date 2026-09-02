import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import SiteLayout from "../../components/shared/SiteLayout";
import { getLegalDoc } from "../../content/legalDocs.generated";
import s from "../../components/lp/lp.module.css";

// /terms — 正本 (document/legal/terms-of-service) を単一ソースとして表示する。
// 本文は scripts/gen-legal.mjs が正本 md から生成 (公開向けに内部注記は除外済み)。
// 言語は next-intl の locale に追従 (ja/en)。

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Terms governing your use of RootLens.",
};

export default async function TermsOfService() {
  const locale = await getLocale();
  const lang = locale === "ja" ? "ja" : "en";
  const doc = getLegalDoc(lang, "terms-of-service");
  // タイトルはセクション見出しに出すので本文 HTML 先頭の <h1> は除去。
  const body = doc.html.replace(/^<h1>[\s\S]*?<\/h1>/, "");
  const subtitle =
    lang === "ja" ? "RootLens の利用条件について。" : "Terms governing your use of RootLens.";

  return (
    <SiteLayout>
      <div className={s.page}>
        <section className={s.section}>
          <div className={s.sectionInner}>
            <header className={s.sectionHeader}>
              <div>
                <div className={s.sectionLabel}>Terms</div>
                <h1 className={s.sectionTitle}>{doc.title}</h1>
              </div>
            </header>
            <div className={s.sectionBody}>
              <p className={s.prose}>{subtitle}</p>
            </div>
            <div className="legalBody" dangerouslySetInnerHTML={{ __html: body }} />
          </div>
        </section>
      </div>
      <style>{`
        .legalBody { max-width: 760px; margin-top: 36px; }
        .legalBody h2 { font-weight: 900; font-size: 1.4rem; line-height: 1.4; color: #fff; margin: 44px 0 14px; }
        .legalBody h3 { font-weight: 900; font-size: 1.08rem; line-height: 1.45; color: #fff; margin: 28px 0 8px; }
        .legalBody p { font-size: 1.02rem; line-height: 1.9; color: var(--rl-wt); margin: 0 0 16px; }
        .legalBody ul, .legalBody ol { font-size: 1.02rem; line-height: 1.9; color: var(--rl-wt); margin: 0 0 16px; padding-left: 22px; }
        .legalBody li { margin: 0 0 8px; }
        .legalBody strong { color: #fff; font-weight: 700; }
        .legalBody a { color: var(--rl-cyan); }
        .legalBody blockquote { margin: 0 0 22px; padding: 18px 20px; background: rgba(255, 255, 255, 0.06); border-left: 3px solid var(--rl-cyan); border-radius: 10px; }
        .legalBody blockquote > :last-child { margin-bottom: 0; }
        .legalBody code { font-family: var(--font-lp-mono, monospace); font-size: 0.86em; background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 3px; padding: 1px 5px; color: #fff; }
        .legalBody table { border-collapse: collapse; width: 100%; margin: 0 0 16px; font-size: 0.92rem; }
        .legalBody th, .legalBody td { border: 1px solid rgba(255, 255, 255, 0.22); padding: 8px 10px; text-align: left; color: var(--rl-wt); }
      `}</style>
    </SiteLayout>
  );
}

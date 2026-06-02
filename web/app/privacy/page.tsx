import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import SiteLayout from "../../components/shared/SiteLayout";
import { getLegalDoc } from "../../content/legalDocs.generated";
import s from "../../components/lp/lp.module.css";

// /privacy — 正本 (document/v0.1.3/legal/privacy-policy) を単一ソースとして表示する。
// 旧マーケ版 (PrivacyPolicyPage) は廃止。本文は scripts/gen-legal.mjs が正本 md から生成
// (公開向けに内部注記は除外済み)。言語は next-intl の locale に追従 (ja/en)。
// レイアウト/タイポは他ページと同じ lp.module.css (.page/.hero/.section) に合わせる。

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How RootLens collects, uses, and protects your data.",
};

export default async function PrivacyPolicy() {
  const locale = await getLocale();
  const lang = locale === "ja" ? "ja" : "en";
  const doc = getLegalDoc(lang, "privacy-policy");
  // タイトルは hero に出すので本文 HTML 先頭の <h1> は除去。
  const body = doc.html.replace(/^<h1>[\s\S]*?<\/h1>/, "");
  const subtitle =
    lang === "ja" ? "RootLens の個人情報の取り扱いについて。" : "How RootLens handles your personal data.";

  return (
    <SiteLayout>
      <div className={s.page}>
        <section className={s.hero}>
          <div className={s.heroInner}>
            <div className={s.heroMain}>
              <h1 className={s.heroTitleArticle}>{doc.title}</h1>
              <p className={s.heroDescription}>{subtitle}</p>
            </div>
          </div>
        </section>
        <section className={s.section}>
          <div className={s.sectionInner}>
            <div className="legalBody" dangerouslySetInnerHTML={{ __html: body }} />
          </div>
        </section>
      </div>
      <style>{`
        .legalBody { max-width: 760px; }
        .legalBody h2 { font-family: var(--font-lp-heading, serif); font-weight: 400; font-size: 1.6rem; line-height: 1.3; letter-spacing: -0.01em; color: var(--lp-text); margin: 44px 0 14px; }
        .legalBody h3 { font-family: var(--font-lp-heading, serif); font-weight: 400; font-size: 1.2rem; line-height: 1.35; color: var(--lp-text); margin: 28px 0 8px; }
        .legalBody p { font-size: 1.08rem; line-height: 1.78; color: var(--lp-text-secondary); margin: 0 0 16px; }
        .legalBody ul { font-size: 1.08rem; line-height: 1.78; color: var(--lp-text-secondary); margin: 0 0 16px; padding-left: 22px; }
        .legalBody li { margin: 0 0 8px; }
        .legalBody strong { color: var(--lp-text); font-weight: 600; }
        .legalBody a { color: var(--lp-accent); }
        .legalBody blockquote { margin: 0 0 22px; padding: 18px 20px; background: var(--lp-bg-alt); border-left: 3px solid var(--lp-accent); border-radius: 10px; }
        .legalBody blockquote > :last-child { margin-bottom: 0; }
        .legalBody code { font-family: var(--font-lp-mono, monospace); font-size: 0.86em; background: var(--lp-bg-alt); border: 1px solid var(--lp-border); border-radius: 3px; padding: 1px 5px; color: var(--lp-text); }
        .legalBody table { border-collapse: collapse; width: 100%; margin: 0 0 16px; font-size: 0.95rem; }
        .legalBody th, .legalBody td { border: 1px solid var(--lp-border); padding: 8px 10px; text-align: left; color: var(--lp-text-secondary); }
      `}</style>
    </SiteLayout>
  );
}

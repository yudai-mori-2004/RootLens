import type { Metadata } from "next";
import SiteLayout from "../../components/shared/SiteLayout";
import { getLegalDoc } from "../../content/legalDocs.generated";

// /privacy — 正本 (document/v0.1.3/legal/privacy-policy) を単一ソースとして表示する。
// 旧マーケ版 (PrivacyPolicyPage: 事業を「content authenticity」とのみ説明・連絡先誤り) は廃止。
// 本文は scripts/gen-legal.mjs が正本 md から生成 (公開向けに内部注記は除外済み)。
// 色は LP パレット (lp.module.css の .page スコープ変数) を hex 直書き = .page 外でも確実に効く。

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How RootLens collects, uses, and protects your data.",
};

export default async function PrivacyPolicy() {
  const doc = getLegalDoc("en", "privacy-policy");
  return (
    <SiteLayout>
      <div className="legalPage">
        <article className="legalDoc" dangerouslySetInnerHTML={{ __html: doc.html }} />
      </div>
      <style>{`
        .legalPage { background: #fafaf6; }
        .legalDoc { max-width: 760px; margin: 0 auto; padding: 64px 24px 96px; color: #14171c;
          font-family: -apple-system, "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif; line-height: 1.65; }
        .legalDoc h1 { font-size: 34px; line-height: 1.2; margin: 0 0 28px; color: #14171c; }
        .legalDoc h2 { font-size: 20px; margin: 36px 0 10px; color: #14171c; }
        .legalDoc h3 { font-size: 16px; margin: 22px 0 6px; color: #14171c; }
        .legalDoc p { margin: 0 0 14px; line-height: 1.8; color: #3f4651; }
        .legalDoc ul { margin: 0 0 16px; padding-left: 22px; color: #3f4651; }
        .legalDoc li { margin: 0 0 8px; line-height: 1.7; }
        .legalDoc strong { color: #14171c; }
        .legalDoc blockquote { margin: 0 0 20px; padding: 16px 18px; border-left: 3px solid #14233b; background: #f3f3ee; border-radius: 10px; }
        .legalDoc blockquote > :last-child { margin-bottom: 0; }
        .legalDoc code { background: #f3f3ee; padding: 1px 6px; border-radius: 4px; font-size: 0.9em; }
        .legalDoc a { color: #14233b; }
        .legalDoc table { border-collapse: collapse; width: 100%; margin: 0 0 16px; }
        .legalDoc th, .legalDoc td { border: 1px solid #dfdfd8; padding: 8px 10px; text-align: left; }
      `}</style>
    </SiteLayout>
  );
}

import { getLocale } from "next-intl/server";
import s from "../lp/lp.module.css";

// 法務・コンプライアンス系ページ (プライバシー / 児童保護) への導線はフッターに置く
// (= Web の慣習。 ストア審査もフッターの URL を見る)。 ヘッダーは本編の導線専用。
export default async function SiteFooter() {
  const locale = await getLocale();
  const ja = locale === "ja";
  const legalLinks = [
    { href: "/privacy", label: ja ? "プライバシーポリシー" : "Privacy Policy" },
    { href: "/safety", label: ja ? "児童保護基準" : "Child Safety" },
  ];

  return (
    <footer className={s.footer}>
      <div className={s.footerInner}>
        <a
          href="https://x.com/rootlens_sol"
          target="_blank"
          rel="noopener noreferrer"
          className={s.ctaSecondary}
        >
          <XIcon />
          Follow RootLens
        </a>
        <div className={s.footerBuiltBy}>
          <a href="https://x.com/moodai0119" target="_blank" rel="noopener noreferrer" className={s.footerLink}>
            Yudai Mori
          </a>
          {" & "}
          <a href="https://x.com/KonoAkito" target="_blank" rel="noopener noreferrer" className={s.footerLink}>
            Akito Kono
          </a>
        </div>
        <nav className={s.footerNav}>
          {legalLinks.map((link) => (
            <a key={link.href} href={link.href} className={s.footerNavLink}>
              {link.label}
            </a>
          ))}
        </nav>
      </div>
    </footer>
  );
}

function XIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.737-8.835L1.254 2.25H8.08l4.253 5.622L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
    </svg>
  );
}

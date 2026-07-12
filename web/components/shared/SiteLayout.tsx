import { getLocale } from "next-intl/server";
import NavBar from "./NavBar";
import SiteFooter from "./SiteFooter";

// NavBar は client component かつ NextIntlClientProvider に messages を渡していないため、
// リンクのラベルはここ (server) でロケール解決して props で渡す。
export default async function SiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const ja = locale === "ja";
  const navItems = [
    { href: "/#model", label: ja ? "仕組み" : "How it works" },
    { href: "/#services", label: ja ? "サービス" : "Services" },
    { href: "/#specs", label: ja ? "データ仕様" : "Data specs" },
    { href: "/sample", label: ja ? "サンプルデータ" : "Sample data" },
    { href: "/contact", label: ja ? "お問い合わせ" : "Contact" },
  ];

  return (
    <>
      <NavBar items={navItems} />
      <main>{children}</main>
      <SiteFooter />
    </>
  );
}

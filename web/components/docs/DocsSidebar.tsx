"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import s from "./docs.module.css";

interface NavItem {
  href: string;
  labelKey: string;
  sub?: boolean;
}

interface NavSection {
  titleKey: string;
  items: NavItem[];
}

const NAV: NavSection[] = [
  {
    titleKey: "gettingStarted",
    items: [
      { href: "/docs", labelKey: "overview" },
      { href: "/docs/trust-model", labelKey: "trustModel" },
    ],
  },
  {
    titleKey: "contentSigning",
    items: [
      { href: "/docs/content-origins", labelKey: "howContentIsSigned" },
      { href: "/docs/content-origins#hardware", labelKey: "hardwareSigning", sub: true },
      { href: "/docs/content-origins#app", labelKey: "appLevelSigning", sub: true },
      { href: "/docs/content-origins#provenance", labelKey: "provenanceGraph", sub: true },
      { href: "/docs/pki", labelKey: "pkiArchitecture" },
    ],
  },
  {
    titleKey: "verificationAndRecord",
    items: [
      { href: "/docs/title-protocol", labelKey: "titleProtocol" },
      { href: "/docs/cnft-structure", labelKey: "cnftStructure" },
    ],
  },
  {
    titleKey: "browserVerification",
    items: [
      { href: "/docs/verification", labelKey: "clientSideVerification" },
    ],
  },
];

export default function DocsSidebar() {
  const pathname = usePathname();
  const t = useTranslations("docs.sidebar");

  return (
    <aside className={s.sidebar}>
      <nav className={s.sidebarInner}>
        {NAV.map((section) => (
          <div key={section.titleKey} className={s.sidebarSection}>
            <div className={s.sidebarSectionTitle}>{t(section.titleKey)}</div>
            {section.items.map((item) => {
              const isActive = item.sub
                ? false
                : pathname === item.href;
              return (
                <a
                  key={item.href}
                  href={item.href}
                  className={[
                    s.sidebarLink,
                    isActive ? s.sidebarLinkActive : "",
                    item.sub ? s.sidebarLinkSub : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {t(item.labelKey)}
                </a>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}

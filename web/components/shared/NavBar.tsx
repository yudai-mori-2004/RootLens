"use client";

import { usePathname } from "next/navigation";
import s from "./shared.module.css";

export default function NavBar() {
  const pathname = usePathname();

  return (
    <nav className={s.nav}>
      <div className={s.navInner}>
        <a href="/" className={s.navLogo}>
          <img src="/logo.png" alt="" className={s.navLogoIcon} />
          <span className={s.navLogoText}>RootLens</span>
        </a>
        <div className={s.navSpacer} />
        <a
          href="/docs"
          className={`${s.navLink} ${pathname.startsWith("/docs") ? s.navLinkActive : ""}`}
        >
          Docs
        </a>
      </div>
    </nav>
  );
}

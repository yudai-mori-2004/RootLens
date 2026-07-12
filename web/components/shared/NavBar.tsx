"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import s from "./shared.module.css";

export interface NavItem {
  href: string;
  label: string;
}

export default function NavBar({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) => !href.includes("#") && pathname === href;

  return (
    <nav className={s.nav}>
      <div className={s.navInner}>
        <a href="/" className={s.navLogo}>
          <img src="/logo.png" alt="" className={s.navLogoIcon} />
          <span className={s.navLogoText}>
            Root<em>Lens</em>
          </span>
        </a>
        <div className={s.navSpacer} />
        <div className={s.navLinks}>
          {items.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className={`${s.navLink} ${isActive(item.href) ? s.navLinkActive : ""}`}
            >
              {item.label}
            </a>
          ))}
        </div>
        <button
          type="button"
          className={s.navBurger}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? "CLOSE" : "MENU"}
        </button>
      </div>
      {open && (
        <div className={s.navMenu}>
          {items.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className={s.navMenuLink}
              onClick={() => setOpen(false)}
            >
              {item.label}
            </a>
          ))}
        </div>
      )}
    </nav>
  );
}

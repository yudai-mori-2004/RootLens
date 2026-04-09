"use client";

import { useState } from "react";
import s from "./docs.module.css";

export default function DocsAccordion({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className={s.accordion}>
      <button
        className={s.accordionToggle}
        data-open={open}
        onClick={() => setOpen(!open)}
      >
        {title}
      </button>
      {open && children}
    </div>
  );
}

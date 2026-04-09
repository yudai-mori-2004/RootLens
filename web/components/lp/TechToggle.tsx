"use client";

import { useState } from "react";

export default function TechToggle({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ marginTop: 32, borderTop: "1px solid var(--docs-border, #d8d8d4)", paddingTop: 20 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          fontSize: "0.85rem",
          fontWeight: 600,
          color: "var(--docs-accent, #1E3A5F)",
        }}
      >
        <span style={{
          display: "inline-block",
          transition: "transform 0.15s ease",
          transform: open ? "rotate(90deg)" : "rotate(0deg)",
          fontSize: "0.7rem",
        }}>
          &#x25B8;
        </span>
        {title}
      </button>
      {open && <div style={{ marginTop: 16 }}>{children}</div>}
    </div>
  );
}

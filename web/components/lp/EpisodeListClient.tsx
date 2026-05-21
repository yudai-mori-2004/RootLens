"use client";
import { useState, type ReactNode } from "react";
import s from "./lp.module.css";

const INITIAL_COUNT = 6;

export function EpisodeListClient({
  children,
  total,
  showAllLabel,
}: {
  children: ReactNode;
  total: number;
  showAllLabel: string;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={s.episodeList} data-collapsed={!expanded ? "" : undefined}>
      {children}
      {!expanded && total > INITIAL_COUNT && (
        <button
          type="button"
          className={s.showAllButton}
          onClick={() => setExpanded(true)}
        >
          {showAllLabel}
        </button>
      )}
    </div>
  );
}

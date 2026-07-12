"use client";

import { useRef, useState } from "react";
import s from "../lp/lp.module.css";

interface Props {
  email: string;
  copyLabel: string;
  copiedLabel: string;
}

export default function ContactCard({ email, copyLabel, copiedLabel }: Props) {
  const [copied, setCopied] = useState(false);
  const emailRef = useRef<HTMLDivElement>(null);

  const copy = async () => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(email);
      ok = true;
    } catch {
      // clipboard API が使えない環境では、アドレスを全選択して execCommand で写す。
      // それも失敗した場合は選択状態だけ残し、手動コピーに繋ぐ。
      if (emailRef.current) {
        const range = document.createRange();
        range.selectNodeContents(emailRef.current);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        try {
          ok = document.execCommand("copy");
        } catch {
          ok = false;
        }
      }
    }
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className={s.contactCard}>
      <div className={s.contactLabel}>E-MAIL</div>
      <div ref={emailRef} className={s.contactEmail}>
        {email}
      </div>
      <div className={s.contactActions}>
        <button type="button" onClick={copy} className={s.ctaPrimary}>
          {copied ? copiedLabel : copyLabel}
        </button>
      </div>
    </div>
  );
}

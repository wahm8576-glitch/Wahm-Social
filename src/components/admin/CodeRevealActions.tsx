"use client";

import { useState } from "react";

export function CodeRevealActions({ codes, csvHref, txtHref }: { codes: string[]; csvHref: string; txtHref: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="flex flex-wrap gap-2">
      <a className="btn-primary" href={csvHref}>
        تحميل CSV
      </a>
      <a className="btn-ghost" href={txtHref}>
        تحميل TXT
      </a>
      <button type="button" className="btn-ghost" onClick={copy}>
        {copied ? "تم النسخ ✓" : "نسخ الكل"}
      </button>
    </div>
  );
}

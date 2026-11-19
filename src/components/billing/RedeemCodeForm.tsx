"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useI18n } from "../I18nProvider";

export function RedeemCodeForm({ compact }: { compact?: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setOk("");
    const res = await fetch("/api/billing/redeem", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.status === 401) {
      router.push("/login?next=/pricing");
      return;
    }
    if (!json.ok) {
      setError(json.error?.message ?? t.pricing.codeError);
      return;
    }
    setOk(json.data?.extended ? t.pricing.codeExtended : t.pricing.codeOk);
    setCode("");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className={compact ? "space-y-2" : "card space-y-3 p-6"}>
      <div>
        <label className="text-sm font-semibold text-ink">{t.pricing.haveCode}</label>
        {!compact && <p className="mt-1 text-sm text-ink-3">{t.pricing.codeHint}</p>}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          name="code"
          dir="ltr"
          autoComplete="off"
          spellCheck={false}
          placeholder="FROST-XXXX-XXXX-XXXX-XXXX"
          className="flex-1 rounded-xl border border-line bg-surface/70 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-accent-400"
        />
        <button type="submit" disabled={busy || !code.trim()} className="btn-primary">
          {busy ? "…" : t.pricing.redeem}
        </button>
      </div>
      {error && <p className="text-sm text-rose-400">{error}</p>}
      {ok && <p className="text-sm text-emerald-500">{ok}</p>}
    </form>
  );
}

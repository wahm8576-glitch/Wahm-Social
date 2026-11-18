"use client";
import Link from "next/link";
import { useState } from "react";
import { useI18n } from "../I18nProvider";
import { LogoMark } from "@/components/layout/Logo";

export function ForgotForm() {
  const { t, locale } = useI18n();
  const dir = locale === "ar" ? "rtl" : "ltr";
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/auth/forgot", { method: "POST", body: JSON.stringify({ email }) });
      const j = await r.json().catch(() => ({}));
      if (r.status === 429) setErr(j?.error?.message ?? t.auth.resetRateLimited);
      else setDone(true);
    } catch {
      setErr(t.auth.resetNetworkError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card mx-auto w-full max-w-md space-y-5 p-8" dir={dir}>
      <div className="flex flex-col items-center gap-3 text-center">
        <LogoMark size={48} />
        <h1 className="text-2xl font-extrabold text-ink">{t.auth.forgotTitle}</h1>
      </div>
      {done ? (
        <div className="space-y-3 text-center">
          <p className="text-sm leading-7 text-emerald-600 dark:text-emerald-300">{t.auth.forgotDone}</p>
          <p className="text-xs text-ink-4">{t.auth.forgotSpam}</p>
          <Link href="/login" className="btn-ghost inline-block">{t.auth.backToLogin}</Link>
        </div>
      ) : (
        <>
          <p className="text-center text-sm leading-7 text-ink-3">{t.auth.forgotLead}</p>
          <label className="block">
            <span className="mb-1 block text-sm text-ink-3">{t.auth.email}</span>
            <input className="input" type="email" dir="ltr" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </label>
          {err && <p className="text-sm text-rose-500">{err}</p>}
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? t.auth.forgotBusy : t.auth.forgotSubmit}
          </button>
          <p className="text-center text-sm text-ink-3">
            {t.auth.remembered}{" "}
            <Link href="/login" className="text-accent-600 hover:underline dark:text-accent-300">
              {t.auth.loginTitle}
            </Link>
          </p>
        </>
      )}
    </form>
  );
}

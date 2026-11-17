"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useI18n } from "../I18nProvider";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const { t } = useI18n();
  const router = useRouter();
  const next = useSearchParams().get("next") || "/account";
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/auth/${mode}`, { method: "POST", body: JSON.stringify(form) });
    const j = await res.json();
    setBusy(false);
    if (!j.ok) return setErr(j.error?.message ?? t.auth.error);
    router.push(next.startsWith("/") ? next : "/account");
    router.refresh();
  }

  async function magic() {
    if (!form.email) return;
    await fetch("/api/auth/magic", { method: "POST", body: JSON.stringify({ email: form.email }) });
    setInfo(t.auth.magicSent);
  }

  return (
    <form onSubmit={submit} className="card mx-auto w-full max-w-md space-y-4 p-8">
      <h1 className="text-center text-2xl font-extrabold text-ink">{mode === "login" ? t.auth.loginTitle : t.auth.registerTitle}</h1>
      {mode === "register" && (
        <label className="block">
          <span className="mb-1 block text-sm text-ink-3">{t.auth.name}</span>
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" />
        </label>
      )}
      <label className="block">
        <span className="mb-1 block text-sm text-ink-3">{t.auth.email}</span>
        <input className="input" type="email" dir="ltr" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm text-ink-3">{t.auth.password}</span>
        <input
          className="input"
          type="password"
          dir="ltr"
          required
          minLength={mode === "register" ? 8 : 1}
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
        />
      </label>
      {mode === "login" && (
        <div className="-mt-2 text-end text-xs">
          <Link href="/forgot-password" className="text-accent-600 hover:underline dark:text-accent-300">
            نسيت كلمة المرور؟ Forgot password?
          </Link>
        </div>
      )}
      {err && <p className="text-sm text-rose-400">{err}</p>}
      {info && <p className="text-sm text-emerald-300">{info}</p>}
      <button className="btn-primary w-full" disabled={busy}>
        {busy ? "…" : mode === "login" ? t.auth.submitLogin : t.auth.submitRegister}
      </button>
      {mode === "login" && (
        <button type="button" onClick={magic} className="btn-ghost w-full">
          ✉ {t.auth.magic}
        </button>
      )}
      <p className="text-center text-sm text-ink-3">
        {mode === "login" ? t.auth.noAccount : t.auth.haveAccount}{" "}
        <Link href={mode === "login" ? "/register" : "/login"} className="text-accent-600 dark:text-accent-300 hover:underline">
          {mode === "login" ? t.nav.register : t.nav.login}
        </Link>
      </p>
    </form>
  );
}

"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useI18n } from "../I18nProvider";
import { GoogleButton } from "./GoogleButton";
import { exchange, fbAuth, fbErrorCode, fbMessage, type PublicFirebaseConfig } from "@/lib/firebase/client";

export function AuthForm({ mode, firebase }: { mode: "login" | "register"; firebase?: PublicFirebaseConfig | null }) {
  const { t } = useI18n();
  const router = useRouter();
  const next = useSearchParams().get("next") || "/account";
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  const done = () => {
    router.push(next.startsWith("/") ? next : "/account");
    router.refresh();
  };

  // Finish a Google sign-in that fell back to a full-page redirect.
  useEffect(() => {
    if (!firebase) return;
    let alive = true;
    (async () => {
      try {
        const auth = await fbAuth(firebase);
        const { getRedirectResult } = await import("firebase/auth");
        const cred = await getRedirectResult(auth);
        if (!cred || !alive) return;
        setBusy(true);
        const r = await exchange(auth, cred);
        if (r.ok) done();
        else setErr(r.message ?? t.auth.error);
      } catch (e) {
        if (alive && fbErrorCode(e)) setErr(fbMessage(e));
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebase?.apiKey]);

  async function submitFirebase(cfg: PublicFirebaseConfig) {
    const fa = await import("firebase/auth");
    const auth = await fbAuth(cfg);
    const email = form.email.trim();
    try {
      let cred;
      if (mode === "register") {
        if (form.password.length < 8) throw Object.assign(new Error(), { code: "auth/weak-password" });
        cred = await fa.createUserWithEmailAndPassword(auth, email, form.password);
        if (form.name) await fa.updateProfile(cred.user, { displayName: form.name }).catch(() => {});
        await fa.sendEmailVerification(cred.user, { url: `${location.origin}/login` }).catch(() => {});
      } else {
        try {
          cred = await fa.signInWithEmailAndPassword(auth, email, form.password);
        } catch (e) {
          const code = fbErrorCode(e);
          if (code !== "auth/invalid-credential" && code !== "auth/user-not-found" && code !== "auth/wrong-password") throw e;
          // Existing site account not yet in Firebase: migrate it with the same password, then retry once.
          const m = await fetch("/api/auth/firebase/migrate", { method: "POST", body: JSON.stringify({ email, password: form.password }) }).then((r) => r.json()).catch(() => null);
          if (!m?.data?.migrated) throw e;
          cred = await fa.signInWithEmailAndPassword(auth, email, form.password);
        }
      }
      const r = await exchange(auth, cred, form.name);
      if (!r.ok) return setErr(r.message ?? t.auth.error);
      done();
    } catch (e) {
      setErr(fbMessage(e));
    }
  }

  async function google() {
    if (!firebase) return;
    setBusy(true);
    setErr("");
    const fa = await import("firebase/auth");
    const auth = await fbAuth(firebase);
    const provider = new fa.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    try {
      const cred = await fa.signInWithPopup(auth, provider);
      const r = await exchange(auth, cred);
      if (!r.ok) setErr(r.message ?? t.auth.error);
      else done();
    } catch (e) {
      const code = fbErrorCode(e);
      // Popups blocked (e.g. in-app browsers / some mobile Safari setups) → full-page redirect.
      if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") {
        await fa.signInWithRedirect(auth, provider);
        return;
      }
      setErr(fbMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    if (firebase) {
      await submitFirebase(firebase);
      setBusy(false);
      return;
    }
    const res = await fetch(`/api/auth/${mode}`, { method: "POST", body: JSON.stringify(form) });
    const j = await res.json();
    setBusy(false);
    if (!j.ok) return setErr(j.error?.message ?? t.auth.error);
    done();
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
      {firebase && (
        <>
          <div className="flex items-center gap-3 text-xs text-ink-4">
            <span className="h-px flex-1 bg-line" />
            أو
            <span className="h-px flex-1 bg-line" />
          </div>
          <GoogleButton onClick={google} busy={busy} label={mode === "login" ? "الدخول عبر Google" : "التسجيل عبر Google"} />
        </>
      )}
      {mode === "login" && !firebase && (
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

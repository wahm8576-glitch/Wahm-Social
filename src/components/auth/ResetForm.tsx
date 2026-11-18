"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../I18nProvider";
import { LogoMark } from "@/components/layout/Logo";
import { fbAuth, fbErrorCode, type PublicFirebaseConfig } from "@/lib/firebase/client";
import { passwordStrength } from "@/lib/auth/passwordStrength";

function Eye({ off }: { off?: boolean }) {
  return off ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M3 3l18 18" />
      <path d="M10.6 10.6A2 2 0 0 0 12 14a2 2 0 0 0 1.4-.6" />
      <path d="M9.9 5.1A9.8 9.8 0 0 1 12 5c5 0 9.3 3.1 11 7.5a11.7 11.7 0 0 1-3.3 4.5" />
      <path d="M6.1 6.1A11.8 11.8 0 0 0 1 12.5C2.7 16.9 7 20 12 20c1.6 0 3.2-.3 4.6-.9" />
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M1 12.5C2.7 8.1 7 5 12 5s9.3 3.1 11 7.5C21.3 16.9 17 20 12 20S2.7 16.9 1 12.5Z" />
      <circle cx="12" cy="12.5" r="3" />
    </svg>
  );
}

function StrengthMeter({ pw, labels }: { pw: string; labels: { weak: string; fair: string; good: string; strong: string; hints: Record<string, string> } }) {
  const { score, hints } = passwordStrength(pw);
  const label = ["", labels.weak, labels.fair, labels.good, labels.strong][score] || "";
  const colors = ["bg-zinc-300 dark:bg-zinc-700", "bg-rose-500", "bg-amber-500", "bg-sky-500", "bg-emerald-500"];
  if (!pw) return null;
  return (
    <div className="space-y-1" aria-live="polite">
      <div className="flex gap-1">
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={`h-1.5 flex-1 rounded-full ${i <= score ? colors[score] : colors[0]}`} />
        ))}
      </div>
      <p className="text-xs text-ink-4">
        {label}
        {hints.length ? ` — ${hints.map((h) => labels.hints[h] || h).join(" · ")}` : ""}
      </p>
    </div>
  );
}

export function ResetForm({ firebase }: { firebase?: PublicFirebaseConfig | null }) {
  const { t, locale } = useI18n();
  const dir = locale === "ar" ? "rtl" : "ltr";
  const params = useSearchParams();
  const oobCode = params.get("oobCode") || "";
  const token = params.get("token") || "";
  const [email, setEmail] = useState("");
  const [checking, setChecking] = useState(Boolean(oobCode));
  const [codeErr, setCodeErr] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);

  const hintLabels = useMemo(
    () => ({
      weak: t.auth.strengthWeak,
      fair: t.auth.strengthFair,
      good: t.auth.strengthGood,
      strong: t.auth.strengthStrong,
      hints: {
        min8: t.auth.hintMin8,
        longer: t.auth.hintLonger,
        mixedCase: t.auth.hintMixed,
        number: t.auth.hintNumber,
        symbol: t.auth.hintSymbol,
      },
    }),
    [t],
  );

  useEffect(() => {
    if (!oobCode) return;
    if (!firebase) {
      setChecking(false);
      setCodeErr(t.auth.codeInvalid);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const { verifyPasswordResetCode } = await import("firebase/auth");
        const em = await verifyPasswordResetCode(await fbAuth(firebase), oobCode);
        if (!alive) return;
        setEmail(em);
        setCodeErr("");
      } catch (e) {
        if (!alive) return;
        const code = fbErrorCode(e);
        setCodeErr(code === "auth/expired-action-code" ? t.auth.codeExpired : t.auth.codeInvalid);
      } finally {
        if (alive) setChecking(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [oobCode, firebase, t.auth.codeExpired, t.auth.codeInvalid]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (pw.length < 8) return setErr(t.auth.passwordTooShort);
    if (pw !== pw2) return setErr(t.auth.passwordMismatch);
    setBusy(true);
    try {
      if (oobCode) {
        if (!firebase) return setErr(t.auth.codeInvalid);
        const { confirmPasswordReset } = await import("firebase/auth");
        await confirmPasswordReset(await fbAuth(firebase), oobCode, pw);
        setOk(true);
        return;
      }
      const r = await fetch("/api/auth/reset", { method: "POST", body: JSON.stringify({ token, password: pw }) });
      const j = await r.json().catch(() => ({}));
      if (!j?.ok) return setErr(j?.error?.message ?? t.auth.codeInvalid);
      setOk(true);
    } catch (e) {
      const code = fbErrorCode(e);
      if (code === "auth/expired-action-code") setErr(t.auth.codeExpired);
      else if (code === "auth/weak-password") setErr(t.auth.passwordTooShort);
      else if (code === "auth/invalid-action-code") setErr(t.auth.codeInvalid);
      else setErr(t.auth.resetNetworkError);
    } finally {
      setBusy(false);
    }
  }

  const shell = (children: React.ReactNode) => (
    <div className="card mx-auto w-full max-w-md space-y-5 p-8" dir={dir}>
      <div className="flex flex-col items-center gap-3 text-center">
        <LogoMark size={48} />
        <h1 className="text-2xl font-extrabold text-ink">{t.auth.resetTitle}</h1>
      </div>
      {children}
    </div>
  );

  if (!oobCode && !token) {
    return shell(
      <div className="space-y-4 text-center">
        <p className="text-sm leading-7 text-ink-3">{t.auth.resetIncomplete}</p>
        <Link href="/forgot-password" className="btn-primary inline-block">{t.auth.requestNewLink}</Link>
      </div>,
    );
  }

  if (checking) {
    return shell(<p className="text-center text-sm text-ink-3">{t.auth.resetChecking}</p>);
  }

  if (oobCode && codeErr) {
    return shell(
      <div className="space-y-4 text-center">
        <p className="text-sm leading-7 text-rose-500 dark:text-rose-300">{codeErr}</p>
        <Link href="/forgot-password" className="btn-primary inline-block">{t.auth.requestNewLink}</Link>
        <Link href="/login" className="btn-ghost inline-block">{t.auth.backToLogin}</Link>
      </div>,
    );
  }

  if (ok) {
    return shell(
      <div className="space-y-4 text-center">
        <p className="text-sm leading-7 text-emerald-600 dark:text-emerald-300">{t.auth.resetSuccess}</p>
        <Link href="/login" className="btn-primary inline-block">{t.auth.goToLogin}</Link>
      </div>,
    );
  }

  const type = show ? "text" : "password";
  return (
    <form onSubmit={submit} className="card mx-auto w-full max-w-md space-y-5 p-8" dir={dir}>
      <div className="flex flex-col items-center gap-3 text-center">
        <LogoMark size={48} />
        <h1 className="text-2xl font-extrabold text-ink">{t.auth.resetTitle}</h1>
      </div>
      {email && (
        <p className="rounded-xl bg-black/[.04] px-3 py-2 text-center text-sm text-ink-3 dark:bg-white/[.06]" dir="ltr">
          {email}
        </p>
      )}
      <label className="block">
        <span className="mb-1 block text-sm text-ink-3">{t.auth.newPassword}</span>
        <div className="relative">
          <input className="input pe-11" type={type} dir="ltr" required minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
          <button type="button" className="absolute inset-y-0 end-0 px-3 text-ink-4 hover:text-ink" onClick={() => setShow((s) => !s)} aria-label={show ? t.auth.hidePassword : t.auth.showPassword}>
            <Eye off={show} />
          </button>
        </div>
        <div className="mt-2">
          <StrengthMeter pw={pw} labels={hintLabels} />
        </div>
      </label>
      <label className="block">
        <span className="mb-1 block text-sm text-ink-3">{t.auth.confirmPassword}</span>
        <input className="input" type={type} dir="ltr" required minLength={8} value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
      </label>
      {err && (
        <p className="text-sm text-rose-500">
          {err}{" "}
          <Link href="/forgot-password" className="underline">
            {t.auth.requestNewLink}
          </Link>
        </p>
      )}
      <button className="btn-primary w-full" disabled={busy}>
        {busy ? t.auth.savingPassword : t.auth.savePassword}
      </button>
    </form>
  );
}

"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useI18n } from "../I18nProvider";
import { LogoMark } from "@/components/layout/Logo";
import { fbAuth, fbErrorCode, type PublicFirebaseConfig } from "@/lib/firebase/client";

export function VerifyEmailForm({ firebase }: { firebase?: PublicFirebaseConfig | null }) {
  const { t, locale } = useI18n();
  const dir = locale === "ar" ? "rtl" : "ltr";
  const oobCode = useSearchParams().get("oobCode") || "";
  const [state, setState] = useState<"missing" | "busy" | "ok" | "err">(!oobCode ? "missing" : "busy");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!oobCode) return;
    if (!firebase) {
      setState("err");
      setErr(t.auth.codeInvalid);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const { applyActionCode } = await import("firebase/auth");
        await applyActionCode(await fbAuth(firebase), oobCode);
        if (alive) setState("ok");
      } catch (e) {
        if (!alive) return;
        const code = fbErrorCode(e);
        setErr(code === "auth/expired-action-code" ? t.auth.codeExpired : t.auth.codeInvalid);
        setState("err");
      }
    })();
    return () => {
      alive = false;
    };
  }, [oobCode, firebase, t.auth.codeExpired, t.auth.codeInvalid]);

  return (
    <div className="card mx-auto w-full max-w-md space-y-5 p-8 text-center" dir={dir}>
      <div className="flex flex-col items-center gap-3">
        <LogoMark size={48} />
        <h1 className="text-2xl font-extrabold text-ink">{t.auth.verifyTitle}</h1>
      </div>
      {state === "busy" && <p className="text-sm text-ink-3">{t.auth.verifyBusy}</p>}
      {state === "ok" && (
        <>
          <p className="text-sm leading-7 text-emerald-600 dark:text-emerald-300">{t.auth.verifyOk}</p>
          <Link href="/login" className="btn-primary inline-block">{t.auth.goToLogin}</Link>
        </>
      )}
      {(state === "err" || state === "missing") && (
        <>
          <p className="text-sm leading-7 text-rose-500 dark:text-rose-300">{state === "missing" ? t.auth.resetIncomplete : err}</p>
          <Link href="/login" className="btn-primary inline-block">{t.auth.goToLogin}</Link>
        </>
      )}
    </div>
  );
}

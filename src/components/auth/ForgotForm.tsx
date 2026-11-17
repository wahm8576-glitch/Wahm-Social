"use client";
import Link from "next/link";
import { useState } from "react";

export function ForgotForm() {
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
      if (r.status === 429) setErr(j?.error?.message ?? "محاولات كثيرة، جرّب بعد شوي.");
      else setDone(true);
    } catch {
      setErr("صار خطأ في الاتصال، جرّب مرة ثانية.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card mx-auto w-full max-w-md space-y-4 p-8" dir="rtl">
      <h1 className="text-center text-2xl font-extrabold text-ink">نسيت كلمة المرور؟</h1>
      {done ? (
        <div className="space-y-3 text-center">
          <p className="text-sm leading-7 text-emerald-600 dark:text-emerald-300">
            إذا كان البريد مسجّل عندنا، بيوصلك رابط لإعادة تعيين كلمة المرور خلال دقائق. الرابط صالح 30 دقيقة.
          </p>
          <p className="text-xs text-ink-4">ما وصلك؟ شيّك على الرسائل غير المرغوبة (Spam).</p>
          <Link href="/login" className="btn-ghost inline-block">رجوع لتسجيل الدخول</Link>
        </div>
      ) : (
        <>
          <p className="text-center text-sm text-ink-3">اكتب بريدك الإلكتروني ونرسل لك رابط تعيين كلمة مرور جديدة.</p>
          <label className="block">
            <span className="mb-1 block text-sm text-ink-3">البريد الإلكتروني</span>
            <input className="input" type="email" dir="ltr" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </label>
          {err && <p className="text-sm text-rose-500">{err}</p>}
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? "جاري الإرسال…" : "أرسل رابط إعادة التعيين"}
          </button>
          <p className="text-center text-sm text-ink-3">
            تذكرتها؟{" "}
            <Link href="/login" className="text-accent-600 hover:underline dark:text-accent-300">
              تسجيل الدخول
            </Link>
          </p>
        </>
      )}
    </form>
  );
}

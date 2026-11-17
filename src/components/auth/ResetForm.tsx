"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

export function ResetForm() {
  const token = useSearchParams().get("token") || "";
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (pw.length < 8) return setErr("كلمة المرور لازم تكون 8 أحرف على الأقل.");
    if (pw !== pw2) return setErr("كلمتا المرور غير متطابقتين.");
    setBusy(true);
    try {
      const r = await fetch("/api/auth/reset", { method: "POST", body: JSON.stringify({ token, password: pw }) });
      const j = await r.json().catch(() => ({}));
      if (!j?.ok) return setErr(j?.error?.message ?? "الرابط غير صالح أو انتهت صلاحيته.");
      setOk(true);
      setTimeout(() => {
        router.push("/account");
        router.refresh();
      }, 1200);
    } catch {
      setErr("صار خطأ في الاتصال، جرّب مرة ثانية.");
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="card mx-auto w-full max-w-md space-y-4 p-8 text-center" dir="rtl">
        <h1 className="text-2xl font-extrabold text-ink">رابط غير مكتمل</h1>
        <p className="text-sm text-ink-3">افتح الرابط من الإيميل كامل، أو اطلب رابط جديد.</p>
        <Link href="/forgot-password" className="btn-primary inline-block">طلب رابط جديد</Link>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="card mx-auto w-full max-w-md space-y-4 p-8" dir="rtl">
      <h1 className="text-center text-2xl font-extrabold text-ink">تعيين كلمة مرور جديدة</h1>
      {ok ? (
        <p className="text-center text-sm text-emerald-600 dark:text-emerald-300">تم تغيير كلمة المرور ✅ جاري تحويلك لحسابك…</p>
      ) : (
        <>
          <label className="block">
            <span className="mb-1 block text-sm text-ink-3">كلمة المرور الجديدة (8 أحرف على الأقل)</span>
            <input className="input" type="password" dir="ltr" required minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-ink-3">تأكيد كلمة المرور</span>
            <input className="input" type="password" dir="ltr" required minLength={8} value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
          </label>
          {err && (
            <p className="text-sm text-rose-500">
              {err}{" "}
              <Link href="/forgot-password" className="underline">طلب رابط جديد</Link>
            </p>
          )}
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? "جاري الحفظ…" : "حفظ كلمة المرور"}
          </button>
        </>
      )}
    </form>
  );
}

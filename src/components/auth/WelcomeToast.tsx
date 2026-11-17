"use client";
import { useEffect, useState } from "react";

/** One-time «أهلاً {الاسم} 👋» toast after sign-in (flag set by the login/register forms). */
export function WelcomeToast() {
  const [name, setName] = useState("");
  useEffect(() => {
    const check = () => {
      try {
        const n = sessionStorage.getItem("frostly_welcome");
        if (n) {
          sessionStorage.removeItem("frostly_welcome");
          setName(n);
          setTimeout(() => setName(""), 4500);
        }
      } catch {}
    };
    check();
    const t = setInterval(check, 800);
    return () => clearInterval(t);
  }, []);
  if (!name) return null;
  return (
    <div role="status" className="fixed inset-x-0 top-20 z-50 flex justify-center px-4" dir="rtl">
      <div className="card animate-in fade-in rounded-2xl px-5 py-3 text-base font-bold text-ink shadow-lg">أهلاً {name} 👋</div>
    </div>
  );
}

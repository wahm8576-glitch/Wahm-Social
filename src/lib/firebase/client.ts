"use client";
/** Browser-side Firebase Auth helpers. The SDK is loaded on demand only when Firebase auth is enabled. */
import type { Auth, UserCredential } from "firebase/auth";

export interface PublicFirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  messagingSenderId?: string;
  storageBucket?: string;
}

let cached: { key: string; auth: Auth } | null = null;

export async function fbAuth(cfg: PublicFirebaseConfig): Promise<Auth> {
  if (cached?.key === cfg.apiKey + cfg.projectId) return cached.auth;
  const { initializeApp, getApps } = await import("firebase/app");
  const { initializeAuth, browserSessionPersistence, browserPopupRedirectResolver } = await import("firebase/auth");
  const name = `frostly-${cfg.projectId}`;
  const app = getApps().find((a) => a.name === name) ?? initializeApp(cfg, name);
  let auth: Auth;
  try {
    auth = initializeAuth(app, { persistence: browserSessionPersistence, popupRedirectResolver: browserPopupRedirectResolver });
  } catch {
    auth = (await import("firebase/auth")).getAuth(app);
  }
  auth.languageCode = document.documentElement.lang || "ar";
  cached = { key: cfg.apiKey + cfg.projectId, auth };
  return auth;
}

/** Send the Firebase ID token to the server, which sets the site's own session cookie. */
export async function exchange(auth: Auth, cred: UserCredential, name?: string): Promise<{ ok: boolean; message?: string }> {
  const idToken = await cred.user.getIdToken();
  const r = await fetch("/api/auth/firebase/session", { method: "POST", body: JSON.stringify({ idToken, name: name || undefined }) });
  const j = await r.json().catch(() => ({}));
  // The site session is the source of truth; don't keep a second Firebase session in the browser.
  await (await import("firebase/auth")).signOut(auth).catch(() => {});
  return j?.ok ? { ok: true } : { ok: false, message: j?.error?.message };
}

const AR: Record<string, string> = {
  "auth/invalid-credential": "البريد أو كلمة المرور غير صحيحة.",
  "auth/wrong-password": "البريد أو كلمة المرور غير صحيحة.",
  "auth/user-not-found": "البريد أو كلمة المرور غير صحيحة.",
  "auth/invalid-email": "البريد الإلكتروني غير صحيح.",
  "auth/email-already-in-use": "هذا البريد مسجّل مسبقاً — سجّل دخول أو استخدم «نسيت كلمة المرور».",
  "auth/weak-password": "كلمة المرور ضعيفة — 8 أحرف على الأقل.",
  "auth/too-many-requests": "محاولات كثيرة، انتظر شوي وجرّب مرة ثانية.",
  "auth/network-request-failed": "مشكلة في الاتصال، تأكد من الإنترنت.",
  "auth/popup-closed-by-user": "تم إغلاق نافذة قوقل قبل إكمال الدخول.",
  "auth/cancelled-popup-request": "تم إلغاء الطلب.",
  "auth/unauthorized-domain": "نطاق الموقع غير مضاف في إعدادات Firebase (Authorized domains).",
  "auth/operation-not-allowed": "طريقة الدخول هذي غير مفعّلة في Firebase.",
  "auth/account-exists-with-different-credential": "البريد مسجّل بطريقة دخول ثانية — سجّل دخول بكلمة المرور أولاً.",
  "auth/user-disabled": "هذا الحساب موقوف.",
};

export const fbErrorCode = (e: unknown) => String((e as { code?: string })?.code ?? "");
export const fbMessage = (e: unknown) => AR[fbErrorCode(e)] ?? "صار خطأ، جرّب مرة ثانية.";

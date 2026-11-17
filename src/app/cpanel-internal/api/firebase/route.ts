import { adminAction } from "@/lib/admin/guard";
import { saveSecrets, getSettings } from "@/lib/site/store";
import { FB_ENABLED_KEY, FB_SA_KEY, FB_WEB_KEY, firebaseStatus, parseServiceAccount, readServiceAccount, readWebConfig, webConfigComplete } from "@/lib/firebase/config";
import { adminAuth } from "@/lib/firebase/admin";

export const dynamic = "force-dynamic";

const WEB = ["apiKey", "authDomain", "projectId", "appId", "messagingSenderId", "storageBucket", "measurementId"] as const;
const clean = (v: FormDataEntryValue | null, max = 300) => String(v ?? "").trim().slice(0, max);

/** Accepts either separate fields or the `firebaseConfig = {...}` snippet pasted from the Firebase console. */
function parseSnippet(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of WEB) {
    const m = raw.match(new RegExp(`["']?${k}["']?\\s*:\\s*["']([^"']+)["']`));
    if (m) out[k] = m[1].trim();
  }
  return out;
}

/** op=save | test | enable | disable | clear */
export async function POST(req: Request) {
  return adminAction("firebase", async (_req, form) => {
    await getSettings();
    const op = clean(form.get("op"), 20);
    if (op === "clear") {
      await saveSecrets((c) => {
        delete c[FB_WEB_KEY];
        delete c[FB_SA_KEY];
        delete c[FB_ENABLED_KEY];
        return c;
      }, "admin: clear firebase");
      return "تم حذف إعدادات Firebase — الموقع رجع لتسجيل الدخول القديم";
    }
    if (op === "disable") {
      await saveSecrets((c) => ({ ...c, [FB_ENABLED_KEY]: "0" }), "admin: disable firebase auth");
      return "تم إيقاف Firebase — تسجيل الدخول القديم شغال";
    }
    if (op === "enable") {
      const st = firebaseStatus();
      if (!st.webComplete) throw new Error("أكمل إعدادات الويب أولاً (apiKey, authDomain, projectId, appId)");
      if (!st.sa) throw new Error("أضف ملف حساب الخدمة (Service account JSON) أولاً");
      if (st.projectMismatch) throw new Error("projectId في إعدادات الويب لا يطابق حساب الخدمة");
      await adminAuth().then((a) => a.listUsers(1));
      await saveSecrets((c) => ({ ...c, [FB_ENABLED_KEY]: "1" }), "admin: enable firebase auth");
      return "تم تفعيل تسجيل الدخول عبر Firebase ✅";
    }
    if (op === "test") {
      const web = readWebConfig();
      const sa = readServiceAccount();
      const lines: string[] = [];
      if (!sa) throw new Error("حساب الخدمة غير محفوظ أو غير صالح");
      try {
        const r = await (await adminAuth()).listUsers(1);
        lines.push(`حساب الخدمة ✅ (${r.users.length ? "فيه مستخدمين" : "ما فيه مستخدمين بعد"})`);
      } catch (e) {
        throw new Error(`حساب الخدمة فشل: ${String((e as Error).message).slice(0, 160)}`);
      }
      if (web.apiKey) {
        try {
          const res = await fetch(`https://www.googleapis.com/identitytoolkit/v3/relyingparty/getProjectConfig?key=${encodeURIComponent(web.apiKey)}`, { signal: AbortSignal.timeout(10_000) });
          const j = (await res.json().catch(() => ({}))) as { authorizedDomains?: string[]; error?: { message?: string } };
          if (!res.ok) lines.push(`مفتاح الويب ❌ ${j.error?.message ?? res.status}`);
          else {
            const host = new URL(req.url).host;
            const site = (req.headers.get("x-forwarded-host") || host).split(":")[0];
            const ok = (j.authorizedDomains ?? []).includes(site);
            lines.push(`مفتاح الويب ✅ · النطاق ${site} ${ok ? "مضاف ✅" : "غير مضاف ❌ (أضفه في Authentication → Settings → Authorized domains)"}`);
          }
        } catch {
          lines.push("ما قدرنا نتحقق من مفتاح الويب");
        }
      }
      return lines.join(" · ");
    }
    // save
    const snippet = parseSnippet(clean(form.get("snippet"), 3000));
    const saRaw = String(form.get("serviceAccount") ?? "").trim();
    let saToStore: string | null = null;
    if (saRaw) {
      if (saRaw.length > 10_000) throw new Error("ملف حساب الخدمة طويل جداً");
      const info = parseServiceAccount(saRaw);
      if (!info) throw new Error("ملف حساب الخدمة غير صالح — الصق محتوى ملف JSON كامل");
      saToStore = saRaw;
    }
    const cur = readWebConfig();
    const next: Record<string, string> = {};
    for (const k of WEB) next[k] = clean(form.get(k)) || snippet[k] || "";
    const any = Object.values(next).some(Boolean);
    const web = any ? next : { ...cur };
    if (any && !webConfigComplete(web as never)) throw new Error("لازم apiKey و authDomain و projectId و appId");
    const sa = saToStore ? parseServiceAccount(saToStore) : readServiceAccount();
    if (sa && web.projectId && sa.projectId !== web.projectId) throw new Error(`projectId مختلف: الويب ${web.projectId} وحساب الخدمة ${sa.projectId}`);
    await saveSecrets((c) => {
      if (any) c[FB_WEB_KEY] = JSON.stringify(web);
      if (saToStore) c[FB_SA_KEY] = saToStore;
      return c;
    }, "admin: update firebase");
    return "تم حفظ إعدادات Firebase (مشفّرة) ✅ — جرّب «اختبار» ثم «تفعيل»";
  })(req);
}

import type { ConnectionsReason } from "@/lib/platforms/types";

/** Human explanations for every locked state, per account privacy. */
export const REASON_COPY: Record<ConnectionsReason, { ar: [string, string]; en: [string, string] }> = {
  account_private: {
    ar: ["الحساب خاص", "صاحب الحساب جعله خاصاً، لذلك لا تُعرض قائمة المتابعين أو المتابَعين لأي أحد."],
    en: ["Private account", "The owner made this account private, so its lists are not shown to anyone."],
  },
  hidden_by_user: {
    ar: ["القائمة مخفية", "صاحب الحساب أخفى هذه القائمة من إعدادات الخصوصية."],
    en: ["List hidden", "The account owner hid this list in their privacy settings."],
  },
  provider_required: {
    ar: ["القائمة عامة لهذا الحساب", "تيك توك لا يتيح قائمة المتابعين الكاملة خارج تطبيقه إلا لشركاء واجهة الباحثين الرسمية، ونحن لا نتجاوز حماية تيك توك. يمكنك فتح القائمة كاملة داخل تيك توك."],
    en: ["This list is public", "TikTok only exposes the full follower list inside its app or to approved Research API partners, and we don't bypass TikTok's protections. You can open the full list on TikTok."],
  },
  login_only: {
    ar: ["متاحة داخل انستقرام فقط", "انستقرام يعرض قوائم المتابعين للمستخدمين المسجلين فقط، ولم يُرجع القائمة لسيرفرنا حالياً."],
    en: ["Available inside Instagram only", "Instagram only shows follower lists to signed-in users, and it didn't return this list to our server right now."],
  },
  not_supported: {
    ar: ["غير متاح حالياً", "تعذر جلب بيانات الحساب الآن، حاول لاحقاً."],
    en: ["Not available right now", "We couldn't load this account right now, try again later."],
  },
};

export const METHOD_COPY: Record<string, { ar: string; en: string }> = {
  official_api: { ar: "واجهة تيك توك الرسمية (Research API)", en: "TikTok official API (Research API)" },
  web_public: { ar: "قائمة المتابعين على موقع تيك توك", en: "TikTok website followers list" },
  mobile_web: { ar: "قائمة المتابعين على نسخة الجوال", en: "TikTok mobile-web followers list" },
  session: { ar: "جلسة تيك توك مسجّلة على السيرفر", en: "Signed-in TikTok session on the server" },
  third_party: { ar: "خدمة عامة بديلة (tikwm)", en: "Public third-party service (tikwm)" },
  instagram_session: { ar: "جلسة انستقرام على السيرفر", en: "Instagram server session" },
};

export const NOTE_COPY: Record<string, { ar: string; en: string }> = {
  ok: { ar: "نجح", en: "worked" },
  tikwm_unavailable: { ar: "الخدمة أوقفت هذه القائمة حالياً", en: "the service has disabled this list for now" },
  tikwm_blocked: { ar: "الخدمة حجبت السيرفر مؤقتاً", en: "the service is blocking the server for now" },
  tikwm_quota: { ar: "تجاوزنا حد الخدمة اليومي", en: "daily service limit reached" },
  not_configured: { ar: "غير مفعّلة", en: "not configured" },
  not_approved: { ar: "مفاتيح التطبيق غير معتمدة لهذه الواجهة (Login Kit فقط)", en: "app keys aren't approved for it (Login Kit only)" },
  empty_unsigned: { ar: "تيك توك رجّع رد فاضي — يطلب توقيع طلبات خاص بتطبيقه ولا نتجاوزه", en: "TikTok returned an empty reply — it requires its own request signing, which we don't bypass" },
  needs_full_profile: { ar: "يحتاج بيانات الحساب الكاملة (انستقرام يحدّ السيرفر حالياً)", en: "needs the full profile (Instagram is throttling the server)" },
  blocked: { ar: "انستقرام رفض الطلب حالياً", en: "Instagram refused the request right now" },
  empty: { ar: "رد فاضي", en: "empty reply" },
  empty_json: { ar: "رد JSON بدون مستخدمين", en: "JSON reply with no users" },
  browser_challenge: { ar: "تيك توك حاجب IP السيرفر (لازم بروكسي سكني SCRAPER_PROXY)", en: "TikTok is blocking the server IP (needs residential SCRAPER_PROXY)" },
  browser_no_secuid: { ar: "ما قدرنا نقرأ معرّف الحساب من الصفحة", en: "could not read the account id from the page" },
  browser_empty: { ar: "المتصفّح فتح تيك توك لكن القائمة رجعت فاضي", en: "browser opened TikTok but the list came back empty" },
  browser_error: { ar: "تعذّر تشغيل متصفح الجلسة على السيرفر", en: "could not start the session browser on the server" },
  error: { ar: "خطأ", en: "error" },
};

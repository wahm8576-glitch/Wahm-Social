/** Bilingual static legal/info pages (markdown). */
export const PAGES: Record<string, { title: { ar: string; en: string }; body: { ar: string; en: string } }> = {
  about: {
    title: { ar: "عن فروستلي", en: "About Frostly" },
    body: {
      ar: `## من نحن\nفروستلي منصة عربية أولاً من **Wahm (@iwahm)** لتحليل الحسابات العامة على تيك توك وانستقرام وتحميل المحتوى العام بسهولة.\n\n## مبادئنا\n- البيانات العامة فقط — لا تجاوز للخصوصية.\n- لا نطلب كلمة مرور حسابك أبداً.\n- شفافية كاملة: نوسم البيانات التجريبية والمخزنة بوضوح.\n\n## التقنية\nبنينا المنصة على Next.js مع طبقة خدمات لكل منصة، ذاكرة مؤقتة، حدود استخدام، ومصادقة JWT.`,
      en: `## Who we are\nFrostly is an Arabic-first platform by **Wahm (@iwahm)** for analyzing public TikTok and Instagram accounts and saving public content easily.\n\n## Principles\n- Public data only — no privacy bypass.\n- We never ask for your account password.\n- Full transparency: demo and cached data are clearly labelled.\n\n## Technology\nBuilt on Next.js with per-platform service adapters, caching, rate limits and JWT auth.`,
    },
  },
  privacy: {
    title: { ar: "سياسة الخصوصية", en: "Privacy Policy" },
    body: {
      ar: `## ما نجمعه
- البريد الإلكتروني والاسم عند إنشاء حساب.
- سجل استخدام مجهول (عدد عمليات البحث والتحميل اليومية).
- أسماء المستخدمين التي تبحث عنها لإحصاءات "الأكثر بحثاً" بشكل مجمّع.

## المدفوعات
المدفوعات تتم عبر **PayPal**. فروستلي لا يستقبل أرقام البطاقات ولا يخزّنها على خوادمه. PayPal يعالج بيانات الدفع وفق سياسة الخصوصية الخاصة به. نحتفظ بسجل محلي للاشتراك (الخطة وتاريخ التجديد ومعرّف الاشتراك) لإدارة حسابك.

## ما لا نجمعه
- كلمات مرور حسابات تيك توك أو انستقرام.
- أي محتوى خاص.
- بيانات بطاقة الدفع.

## الكوكيز
نستخدم كوكي جلسة آمنة (httpOnly) وكوكي اللغة فقط.

## حقوقك
يمكنك طلب حذف حسابك في أي وقت عبر صفحة التواصل: wahmsec@gmail.com

البائع: **Frostly**.`,
      en: `## What we collect
- Email and name when you create an account.
- Anonymous usage counters (daily lookups and downloads).
- Searched usernames, aggregated for "trending" stats.

## Payments
Payments are processed by **PayPal**. Frostly does not receive or store your card numbers on our servers. PayPal handles payment data under its own privacy policy. We keep a local record of your subscription (plan, renewal date, and subscription id) to manage your account.

## What we don't collect
- TikTok or Instagram passwords.
- Any private content.
- Payment card details.

## Cookies
We only use a secure httpOnly session cookie and a language cookie.

## Your rights
Request account deletion at any time via the contact page or wahmsec@gmail.com

Seller: **Frostly**.`,
    },
  },
  terms: {
    title: { ar: "شروط الاستخدام", en: "Terms of Service" },
    body: {
      ar: `## الاستخدام المقبول
- استخدم الخدمة للمحتوى العام فقط وللأغراض الشخصية أو التحليلية.
- لا تعِد نشر محتوى الآخرين دون إذنهم.
- يُمنع استخدام الخدمة للتحرش أو التتبع المؤذي.

## الاشتراكات والدفع
- البائع هو **Frostly**. تُعالج المدفوعات عبر **PayPal**.
- تتجدد اشتراكات برو وأعمال تلقائياً ما لم تُلغَ. يمكنك الإلغاء في أي وقت من صفحة حسابي؛ تظل الميزات فعالة حتى نهاية الفترة المدفوعة.
- الأسعار معروضة بالدولار الأمريكي وقد تُضاف ضرائب وفق قواعد PayPal ومنطقتك.
- سياسة الاسترجاع موضّحة في صفحة [الاسترجاع](/refund): استرجاع خلال 14 يوماً عند الطلب المعقول.

## إخلاء مسؤولية
فروستلي غير تابع لتيك توك أو انستقرام. توفر البيانات يعتمد على المنصات نفسها.

للتواصل: wahmsec@gmail.com`,
      en: `## Acceptable use
- Use the service for public content only, for personal or analytical purposes.
- Don't repost others' content without permission.
- Harassment or harmful tracking is prohibited.

## Subscriptions and payment
- The seller is **Frostly**. Payments are processed by **PayPal**.
- Pro and Business plans renew automatically unless cancelled. You can cancel any time from your account page; features stay active until the end of the paid period.
- Prices are shown in USD; taxes may be added according to PayPal's rules and your region.
- Refunds are described on the [Refund Policy](/refund) page: a 14-day refund on a reasonable request.

## Disclaimer
Frostly is not affiliated with TikTok or Instagram. Data availability depends on the platforms.

Contact: wahmsec@gmail.com`,
    },
  },
  refund: {
    title: { ar: "سياسة الاسترجاع", en: "Refund Policy" },
    body: {
      ar: `## الاسترجاع خلال 14 يوماً
إذا لم يناسبك الاشتراك، يمكنك طلب استرجاع خلال **14 يوماً** من تاريخ الدفع. راسلنا على **wahmsec@gmail.com** من البريد المرتبط بحسابك، واذكر معرّف الدفع إن وُجد.

## بعد 14 يوماً
بعد هذه المدة لا نضمن الاسترجاع للفترة المستخدمة، وقد ننظر في الحالات الاستثنائية (خصم مكرر أو خطأ تقني).

## طريقة الاسترجاع
المدفوعات تتم عبر **PayPal**، ويُعاد المبلغ عادةً إلى نفس طريقة الدفع في PayPal خلال عدة أيام عمل بعد الموافقة.

## الإلغاء
إلغاء التجديد لا يوقف الفترة المدفوعة الحالية؛ تظل الميزات تعمل حتى تاريخ انتهائها. يمكنك الإلغاء من صفحة حسابي.

البائع: **Frostly**. للتواصل: wahmsec@gmail.com`,
      en: `## 14-day refund
If the subscription isn't right for you, you may request a refund within **14 days** of payment. Email **wahmsec@gmail.com** from the address on your account and include the payment reference if you have one.

## After 14 days
We don't guarantee a refund for time already used after this window, though we may consider exceptional cases (a duplicate charge or a technical error).

## How refunds are paid
Payments are processed by **PayPal**. Approved refunds are typically returned to the original PayPal payment method within several business days.

## Cancellation
Cancelling stops future renewals but does not end the current paid period; features stay active until it expires. You can cancel from your account page.

Seller: **Frostly**. Contact: wahmsec@gmail.com`,
    },
  },
  contact: {
    title: { ar: "تواصل معنا", en: "Contact" },
    body: {
      ar: `## الدعم
تواصل معنا عبر البريد: **wahmsec@gmail.com**
أو عبر X: **@iwahm**

## الشركات
لطلبات خطة الأعمال والوصول إلى API، راسلنا مع وصف مختصر لحالة الاستخدام.`,
      en: `## Support
Email us at **wahmsec@gmail.com**
or reach us on X: **@iwahm**

## Business
For Business plan and API access, message us with a short description of your use case.`,
    },
  },
  docs: {
    title: { ar: "دليل الاستخدام", en: "User guide" },
    body: {
      ar: `## البحث عن حساب\n1. اختر المنصة (تيك توك أو انستقرام).\n2. اكتب اسم المستخدم أو الصق رابط الحساب.\n3. اضغط **بحث**.\n\n## تحميل منشور\n1. افتح أي منشور من شبكة المنشورات.\n2. اضغط **تحميل الفيديو** أو **تحميل الصورة**.\n- أو الصق الرابط مباشرة في **مركز التحميل**.\n\n## التحليلات\nتبويب **التحليلات** يعرض معدل التفاعل والمتوسطات. أفضل وقت للنشر والرسوم البيانية وتقدير الأرباح متاحة في **برو**.\n\n## المقارنة والمراقبة (برو)\n- **المقارنة**: ضع حتى ٤ حسابات واضغط قارن.\n- **المراقبة**: أضف حسابات من صفحة الملف وتابع تغير المتابعين.\n\n## مصدر البيانات\n- **مباشر**: جُلبت الآن.\n- **من الذاكرة المؤقتة**: جُلبت خلال الدقائق الماضية.\n- **تجريبي**: المنصة تحد الطلبات مؤقتاً.`,
      en: `## Look up an account\n1. Choose the platform (TikTok or Instagram).\n2. Type the username or paste the profile link.\n3. Press **Search**.\n\n## Download a post\n1. Open any post from the grid.\n2. Press **Download video** or **Download image**.\n- Or paste the link straight into the **Download center**.\n\n## Analytics\nThe **Analytics** tab shows engagement and averages. Best time to post, charts and earnings estimates are **Pro**.\n\n## Compare & watchlist (Pro)\n- **Compare**: add up to 4 accounts and press compare.\n- **Watchlist**: add accounts from a profile page and track follower changes.\n\n## Data source labels\n- **Live**: fetched just now.\n- **Cached**: fetched in the last few minutes.\n- **Demo**: the platform is rate-limiting temporarily.`,
    },
  },
};

/** Programmatic SEO landing pages under /tools/[slug] — each targets a high-volume query. */
export type ToolMode = "download" | "profile" | "stories" | "analytics";
export interface Tool {
  title: { ar: string; en: string };
  desc: { ar: string; en: string };
  platform: "tiktok" | "instagram";
  mode: ToolMode;
  keywords: string[];
}

const T = (platform: Tool["platform"], mode: ToolMode, title: Tool["title"], desc: Tool["desc"], keywords: string[]): Tool => ({ platform, mode, title, desc, keywords });

export const TOOLS: Record<string, Tool> = {
  "tiktok-downloader": T("tiktok", "download",
    { ar: "تحميل فيديو تيك توك بدون علامة مائية", en: "TikTok Downloader — Download TikTok Videos Without Watermark" },
    { ar: "الصق رابط فيديو تيك توك وحمله بجودة HD بدون شعار، مجاناً وبدون تسجيل — على الجوال والكمبيوتر.", en: "Paste a TikTok link and save it in HD without the watermark — free, no login, on iPhone, Android and PC." },
    ["tiktok downloader", "download tiktok without watermark", "tiktok video downloader", "تحميل فيديو تيك توك", "تحميل تيك توك بدون علامة مائية"]),
  "tiktok-mp3-downloader": T("tiktok", "download",
    { ar: "تحميل صوت تيك توك MP3", en: "TikTok MP3 Downloader — TikTok to MP3" },
    { ar: "حوّل أي فيديو تيك توك إلى ملف صوتي MP3 واحفظ الأغاني والأصوات الرائجة.", en: "Convert any TikTok to MP3 and save trending sounds and songs." },
    ["tiktok mp3", "tiktok to mp3", "tiktok audio downloader", "تحميل صوت تيك توك", "تحويل تيك توك mp3"]),
  "tiktok-photo-downloader": T("tiktok", "download",
    { ar: "تحميل صور وسلايدشو تيك توك", en: "TikTok Photo & Slideshow Downloader" },
    { ar: "حمّل صور منشورات تيك توك (السلايدشو) بجودة كاملة.", en: "Download every photo from TikTok slideshow posts in full quality." },
    ["tiktok slideshow downloader", "tiktok photo download", "تحميل صور تيك توك"]),
  "instagram-downloader": T("instagram", "download",
    { ar: "تحميل من انستقرام — ريلز وصور وفيديو", en: "Instagram Downloader — Reels, Photos & Videos" },
    { ar: "حمّل ريلز وصور ومنشورات انستقرام العامة بأعلى جودة، مجاناً وبدون تسجيل.", en: "Download public Instagram reels, photos and posts in top quality — free, no login." },
    ["instagram downloader", "instagram video downloader", "تحميل من انستقرام", "تحميل فيديو انستا"]),
  "instagram-reels-downloader": T("instagram", "download",
    { ar: "تحميل ريلز انستقرام", en: "Instagram Reels Downloader" },
    { ar: "الصق رابط الريلز وحمّله MP4 بجودة عالية.", en: "Paste a Reel link and save it as a high-quality MP4." },
    ["instagram reels downloader", "download instagram reels", "reels download", "تحميل ريلز", "تنزيل ريلز انستا"]),
  "instagram-photo-downloader": T("instagram", "download",
    { ar: "تحميل صور انستقرام", en: "Instagram Photo Downloader" },
    { ar: "احفظ صور منشورات انستقرام العامة بدقتها الأصلية.", en: "Save public Instagram post photos in original resolution." },
    ["instagram photo downloader", "save instagram photo", "حفظ صور انستقرام"]),
  "tiktok-profile-viewer": T("tiktok", "profile",
    { ar: "عارض حسابات تيك توك — البحث عن حساب", en: "TikTok Profile Viewer & Account Lookup" },
    { ar: "اعرض أي حساب تيك توك عام بدون تسجيل: المتابعين، الإعجابات، وأحدث الفيديوهات.", en: "View any public TikTok profile without an account: followers, likes and latest videos." },
    ["tiktok profile viewer", "tiktok viewer", "tiktok account lookup", "عرض حساب تيك توك", "البحث عن حساب تيك توك"]),
  "instagram-profile-viewer": T("instagram", "profile",
    { ar: "عارض حسابات انستقرام", en: "Instagram Profile Viewer" },
    { ar: "اعرض حسابات انستقرام العامة، عدد المتابعين، والإحصائيات بدون تسجيل.", en: "View public Instagram profiles, follower counts and stats without logging in." },
    ["instagram profile viewer", "insta viewer", "view instagram without account", "عرض حساب انستقرام"]),
  "instagram-profile-picture-viewer": T("instagram", "profile",
    { ar: "عرض وتكبير صورة بروفايل انستقرام", en: "Instagram Profile Picture Viewer (HD)" },
    { ar: "شاهد صورة البروفايل لأي حساب انستقرام عام بحجم كبير واحفظها.", en: "See and save any public Instagram profile picture in large size." },
    ["instagram profile picture viewer", "insta dp viewer", "تكبير صورة بروفايل انستقرام"]),
  "instagram-story-viewer": T("instagram", "stories",
    { ar: "مشاهدة وتحميل ستوري انستقرام العامة", en: "Instagram Story Viewer & Downloader" },
    { ar: "شاهد ستوري الحسابات العامة وحمّلها — الحسابات الخاصة غير مدعومة احتراماً للخصوصية.", en: "Watch and save stories from public accounts — private accounts are never supported." },
    ["instagram story viewer", "instagram story downloader", "story saver", "مشاهدة ستوري انستقرام", "تحميل ستوري انستا"]),
  "tiktok-engagement-calculator": T("tiktok", "analytics",
    { ar: "حاسبة معدل التفاعل في تيك توك", en: "TikTok Engagement Rate Calculator" },
    { ar: "احسب معدل التفاعل لأي حساب تيك توك عام في ثوانٍ.", en: "Calculate the engagement rate of any public TikTok account in seconds." },
    ["tiktok engagement rate calculator", "tiktok analytics", "حساب معدل التفاعل تيك توك"]),
  "instagram-engagement-calculator": T("instagram", "analytics",
    { ar: "حاسبة معدل التفاعل في انستقرام", en: "Instagram Engagement Rate Calculator" },
    { ar: "احسب معدل التفاعل لأي حساب انستقرام عام.", en: "Calculate the engagement rate of any public Instagram account." },
    ["instagram engagement rate calculator", "instagram analytics", "حساب معدل التفاعل انستقرام"]),
  "tiktok-money-calculator": T("tiktok", "analytics",
    { ar: "حاسبة أرباح تيك توك — كم يربح المؤثر؟", en: "TikTok Money Calculator — Influencer Earnings" },
    { ar: "قدّر سعر الإعلان وأرباح أي صانع محتوى على تيك توك من المتابعين والتفاعل.", en: "Estimate sponsored-post pricing and earnings for any TikTok creator from followers and engagement." },
    ["tiktok money calculator", "influencer earnings calculator", "حاسبة أرباح تيك توك", "كم يربح المؤثر"]),
  "tiktok-follower-count": T("tiktok", "profile",
    { ar: "عدد متابعين تيك توك — عداد المتابعين", en: "TikTok Follower Count Checker" },
    { ar: "اعرف عدد متابعين وإعجابات أي حساب تيك توك عام الآن.", en: "Check the follower and like count of any public TikTok account right now." },
    ["tiktok follower count", "live follower count tiktok", "عدد متابعين تيك توك", "عداد متابعين"]),
};

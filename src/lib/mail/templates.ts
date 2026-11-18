import { escapeHtml } from "./escape";

export const BRAND_FROM_NAME = "Frostly | فروستلي";
export const RESET_SUBJECT = "إعادة تعيين كلمة المرور – Frostly";
export const VERIFY_SUBJECT = "تأكيد بريدك الإلكتروني – Frostly";
export const RESET_TTL_HOURS = 1;

export type MailKind = "reset" | "verify";

export interface BrandedMail {
  subject: string;
  text: string;
  html: string;
  fromName: string;
}

export function logoUrl(origin: string): string {
  return `${origin.replace(/\/$/, "")}/frostly-email-banner.png`;
}

function copy(kind: MailKind) {
  if (kind === "verify") {
    return {
      subject: VERIFY_SUBJECT,
      preview: "أكد بريدك الإلكتروني لتفعيل حسابك في فروستلي.",
      heading: "تأكيد البريد الإلكتروني",
      body: "شكراً لتسجيلك في فروستلي. اضغط الزر أدناه لتأكيد بريدك الإلكتروني وتفعيل حسابك.",
      button: "تأكيد البريد الإلكتروني",
      expiry: "رابط التأكيد صالح لمدة ساعة واحدة.",
      ignore: "إذا لم تُنشئ حساباً لدينا، يمكنك تجاهل هذه الرسالة بأمان.",
      en: "Please confirm your email address to activate your Frostly account. This link expires in 1 hour. If you didn’t create an account, ignore this message.",
    };
  }
  return {
    subject: RESET_SUBJECT,
    preview: "طلبت إعادة تعيين كلمة المرور لحسابك في فروستلي.",
    heading: "إعادة تعيين كلمة المرور",
    body: "وصلنا طلب لإعادة تعيين كلمة المرور لحسابك في فروستلي. اضغط الزر أدناه لاختيار كلمة مرور جديدة.",
    button: "تعيين كلمة مرور جديدة",
    expiry: "هذا الرابط صالح لمدة ساعة واحدة ولمرة واحدة فقط.",
    ignore: "إذا لم تطلب إعادة تعيين كلمة المرور، تجاهل هذه الرسالة وستبقى كلمة مرورك كما هي.",
    en: "We received a request to reset your Frostly password. This link expires in 1 hour and can be used once. If you didn’t request this, you can ignore this email.",
  };
}

/** Formal RTL Arabic HTML email + English line. Table layout, inline CSS, Gmail dark-mode safe. */
export function brandedActionEmail(opts: {
  kind: MailKind;
  displayName: string;
  link: string;
  origin: string;
  year?: number;
  /** Overrides the default one-hour expiry sentence (e.g. legacy 30-minute tokens). */
  expiryNote?: string;
  enLine?: string;
}): BrandedMail {
  const c = copy(opts.kind);
  if (opts.expiryNote) c.expiry = opts.expiryNote;
  if (opts.enLine) c.en = opts.enLine;
  const name = opts.displayName;
  const link = escapeHtml(opts.link);
  const origin = opts.origin.replace(/\/$/, "");
  const home = escapeHtml(origin);
  const logo = escapeHtml(logoUrl(origin));
  const year = opts.year ?? new Date().getFullYear();
  const greeting = `مرحباً ${name}`;

  const text = [
    greeting,
    "",
    c.body,
    c.button + ":",
    opts.link,
    "",
    c.expiry,
    c.ignore,
    "",
    c.en,
    "",
    `Frostly | فروستلي`,
    origin,
    String(year),
  ].join("\n");

  // Outer navy so the card stays readable in Gmail dark mode; every cell has a solid bgcolor.
  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(c.subject)}</title>
<style>
  :root { color-scheme: light dark; }
  @media (prefers-color-scheme: dark) {
    .shell { background-color: #070f16 !important; }
    .card { background-color: #122333 !important; }
    .title, .greet, .body { color: #e8eef2 !important; }
    .muted, .foot { color: #9bb0c0 !important; }
    .rule { border-color: #2a4152 !important; }
  }
</style>
</head>
<body class="shell" style="margin:0;padding:0;background-color:#e8eef2;font-family:Tahoma,'Segoe UI',Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(c.preview)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="shell" bgcolor="#e8eef2" style="background-color:#e8eef2;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" class="card" bgcolor="#ffffff" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #d5e0e8;">
          <tr>
            <td bgcolor="#0b1f2a" style="background-color:#0b1f2a;padding:0;text-align:center;">
              <a href="${home}" style="text-decoration:none;">
                <img src="${logo}" width="600" alt="Frostly | فروستلي" style="display:block;width:100%;max-width:600px;height:auto;border:0;">
              </a>
            </td>
          </tr>
          <tr>
            <td dir="rtl" style="padding:28px 32px 8px;text-align:right;">
              <p class="greet" style="margin:0 0 16px;font-size:18px;font-weight:bold;color:#0b1f2a;">${escapeHtml(greeting)}</p>
              <h1 class="title" style="margin:0 0 12px;font-size:22px;line-height:1.5;color:#0b1f2a;">${escapeHtml(c.heading)}</h1>
              <p class="body" style="margin:0 0 24px;font-size:15px;line-height:1.9;color:#1e3342;">${escapeHtml(c.body)}</p>
              <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto 24px;">
                <tr>
                  <td bgcolor="#4f6ff0" style="background-color:#4f6ff0;border-radius:10px;">
                    <a href="${link}" style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:10px;border:1px solid #4f6ff0;">${escapeHtml(c.button)}</a>
                  </td>
                </tr>
              </table>
              <p class="muted" style="margin:0 0 8px;font-size:13px;line-height:1.8;color:#5b7384;">${escapeHtml(c.expiry)}</p>
              <p class="muted" style="margin:0 0 20px;font-size:13px;line-height:1.8;color:#5b7384;">${escapeHtml(c.ignore)}</p>
              <hr class="rule" style="border:none;border-top:1px solid #e2eaf0;margin:8px 0 16px;">
              <p dir="ltr" class="muted" style="margin:0 0 8px;font-size:12px;line-height:1.6;color:#5b7384;text-align:left;">${escapeHtml(c.en)}</p>
            </td>
          </tr>
          <tr>
            <td class="foot" bgcolor="#f4f7f9" style="background-color:#f4f7f9;padding:16px 32px 20px;text-align:center;font-size:12px;line-height:1.7;color:#5b7384;">
              <a href="${home}" style="color:#4f6ff0;text-decoration:none;font-weight:bold;">Frostly | فروستلي</a>
              <br>
              <a href="${home}" style="color:#5b7384;text-decoration:none;">${home.replace(/^https:\/\//, "")}</a>
              <br>
              © ${year} Frostly
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject: c.subject, text, html, fromName: BRAND_FROM_NAME };
}

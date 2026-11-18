import { test } from "node:test";
import assert from "node:assert/strict";
import { extractOobCode, greetingName, siteResetUrl, siteVerifyUrl } from "../src/lib/firebase/links";
import { escapeHtml } from "../src/lib/mail/escape";
import { BRAND_FROM_NAME, RESET_SUBJECT, VERIFY_SUBJECT, brandedActionEmail, logoUrl } from "../src/lib/mail/templates";
import { passwordStrength } from "../src/lib/auth/passwordStrength";

test("extractOobCode reads Firebase action URLs and rejects junk", () => {
  const link =
    "https://frostly-53686.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=ABCDEFghijk0123456789&apiKey=x&lang=ar";
  assert.equal(extractOobCode(link), "ABCDEFghijk0123456789");
  assert.equal(extractOobCode("https://example.com/?oobCode=short"), null);
  assert.equal(extractOobCode("not a url"), null);
  assert.equal(extractOobCode("https://example.com/"), null);
});

test("greetingName prefers display name, then email local-part", () => {
  assert.equal(greetingName("وهاب أحمد", "x@example.com"), "وهاب أحمد");
  assert.equal(greetingName("  ", "wahm3401@gmail.com"), "wahm3401");
  assert.equal(greetingName(null, "user@site"), "user");
  assert.equal(greetingName(undefined, ""), "ضيفنا");
});

test("site reset / verify URLs encode the oob code", () => {
  assert.equal(
    siteResetUrl("https://wahm-social.onrender.com/", "abc+def"),
    "https://wahm-social.onrender.com/reset-password?oobCode=abc%2Bdef",
  );
  assert.equal(siteVerifyUrl("https://wahm-social.onrender.com", "xyz"), "https://wahm-social.onrender.com/verify-email?oobCode=xyz");
});

test("escapeHtml prevents XSS in names", () => {
  assert.equal(escapeHtml(`<img src=x onerror="alert(1)"> & '"`), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;&quot;");
});

test("branded reset email has official copy, logo, button, expiry, and text alternative", () => {
  const mail = brandedActionEmail({
    kind: "reset",
    displayName: `<script>xss</script>`,
    link: "https://wahm-social.onrender.com/reset-password?oobCode=TESTCODE99",
    origin: "https://wahm-social.onrender.com",
    year: 2026,
  });
  assert.equal(mail.fromName, BRAND_FROM_NAME);
  assert.equal(mail.subject, RESET_SUBJECT);
  assert.match(mail.html, /dir="rtl"/);
  assert.match(mail.html, /مرحباً &lt;script&gt;xss&lt;\/script&gt;/);
  assert.doesNotMatch(mail.html, /<script>xss<\/script>/);
  assert.match(mail.html, /تعيين كلمة مرور جديدة/);
  assert.match(mail.html, /صالح لمدة ساعة واحدة/);
  assert.match(mail.html, /إذا لم تطلب/);
  assert.match(mail.html, /Frostly \| فروستلي/);
  assert.match(mail.html, /© 2026 Frostly/);
  assert.match(mail.html, /frostly-email-banner\.png/);
  assert.equal(logoUrl("https://wahm-social.onrender.com/"), "https://wahm-social.onrender.com/frostly-email-banner.png");
  assert.match(mail.html, /https:\/\/wahm-social\.onrender\.com\/reset-password\?oobCode=TESTCODE99/);
  assert.match(mail.html, /prefers-color-scheme:\s*dark/);
  assert.match(mail.html, /If you didn’t request this/i);
  assert.match(mail.text, /مرحباً <script>xss<\/script>/);
  assert.match(mail.text, /https:\/\/wahm-social\.onrender\.com\/reset-password\?oobCode=TESTCODE99/);
  assert.match(mail.text, /We received a request to reset your Frostly password/);
  assert.doesNotMatch(mail.html + mail.text, /firebaseapp\.com/);
});

test("branded verification email uses the verify subject and button", () => {
  const mail = brandedActionEmail({
    kind: "verify",
    displayName: "وهاب",
    link: "https://wahm-social.onrender.com/verify-email?oobCode=VCODE1234",
    origin: "https://wahm-social.onrender.com",
  });
  assert.equal(mail.subject, VERIFY_SUBJECT);
  assert.match(mail.html, /مرحباً وهاب/);
  assert.match(mail.html, /تأكيد البريد الإلكتروني/);
  assert.match(mail.text, /confirm your email/i);
});

test("passwordStrength scores short, mixed, and strong passwords", () => {
  assert.equal(passwordStrength("abc").score, 1);
  assert.ok(passwordStrength("abc").hints.includes("min8"));
  assert.equal(passwordStrength("abcdefgh").score, 1);
  assert.ok(passwordStrength("Abcdefgh1!").score >= 3);
  assert.equal(passwordStrength("Abcdefghijkl1!").score, 4);
});

import { smtpDiag, smtpReady, type SmtpConfig } from "../src/lib/mail/config";

const smtp = (over: Partial<SmtpConfig> = {}): SmtpConfig => ({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  user: "sender@gmail.com",
  pass: "super-secret-app-password",
  fromName: "Frostly",
  fromAddress: "sender@gmail.com",
  replyTo: "",
  ...over,
});

test("smtpReady requires host, port, and from or user — not the password", () => {
  assert.equal(smtpReady(smtp()), true);
  assert.equal(smtpReady(smtp({ pass: "" })), true);
  assert.equal(smtpReady(smtp({ host: "", pass: "x" })), false);
  assert.equal(smtpReady(smtp({ fromAddress: "", user: "" })), false);
});

test("smtpDiag never includes the password", () => {
  const line = smtpDiag(smtp());
  assert.match(line, /ready=true/);
  assert.match(line, /host=smtp\.gmail.com/);
  assert.match(line, /port=587/);
  assert.match(line, /hasPass=true/);
  assert.doesNotMatch(line, /super-secret/);
  assert.doesNotMatch(line, /app-password/);
});

import { smtpConnectAttempts } from "../src/lib/mail/config";

test("smtpConnectAttempts tries Gmail 587 then 465, or 465 then 587 if already on 465", () => {
  const base = smtp();
  const a = smtpConnectAttempts({ ...base, host: "smtp.gmail.com", port: 587, secure: false });
  assert.deepEqual(
    a.map((c) => ({ host: c.host, port: c.port, secure: c.secure })),
    [
      { host: "smtp.gmail.com", port: 587, secure: false },
      { host: "smtp.gmail.com", port: 465, secure: true },
    ],
  );
  const b = smtpConnectAttempts({ ...base, host: "smtp.gmail.com", port: 465, secure: true });
  assert.equal(b[0].port, 465);
  assert.equal(b[0].secure, true);
  assert.equal(b[1].port, 587);
  assert.equal(b[1].secure, false);
  const other = smtpConnectAttempts({ ...base, host: "smtp.example.com", port: 587, secure: false });
  assert.equal(other.length, 1);
  assert.equal(other[0].host, "smtp.example.com");
});

import { buildBrevoPayload } from "../src/lib/mail/brevo-payload";

test("buildBrevoPayload has sender, html, text, and no API key field", () => {
  const body = buildBrevoPayload(
    { to: "user@example.com", subject: "إعادة تعيين كلمة المرور – Frostly", text: "plain", html: "<p>hi</p>" },
    "wahmsec@gmail.com",
    'Frostly | فروستلي"',
  );
  assert.equal(body.sender.email, "wahmsec@gmail.com");
  assert.equal(body.sender.name, "Frostly | فروستلي");
  assert.equal(body.to[0].email, "user@example.com");
  assert.equal(body.htmlContent, "<p>hi</p>");
  assert.equal(body.textContent, "plain");
  assert.ok(!("api-key" in body));
  assert.ok(!("apiKey" in body));
  assert.doesNotMatch(JSON.stringify(body), /xkeysib/i);
});

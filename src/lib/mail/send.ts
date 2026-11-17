import "server-only";
import { readSmtp, smtpReady, type SmtpConfig } from "./config";

export interface MailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Send one email through the admin-configured SMTP server. Throws a short Arabic message on failure. */
export async function sendMail(m: MailInput, cfg: SmtpConfig = readSmtp()): Promise<{ messageId: string }> {
  if (!smtpReady(cfg)) throw new Error("البريد (SMTP) غير مضبوط في لوحة التحكم");
  const nodemailer = (await import("nodemailer")).default;
  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
    connectionTimeout: 12_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  const fromAddr = cfg.fromAddress || cfg.user;
  const info = await transport.sendMail({
    from: cfg.fromName ? `"${cfg.fromName.replace(/"/g, "")}" <${fromAddr}>` : fromAddr,
    to: m.to,
    replyTo: cfg.replyTo || undefined,
    subject: m.subject,
    text: m.text,
    html: m.html,
  });
  return { messageId: String(info.messageId ?? "") };
}

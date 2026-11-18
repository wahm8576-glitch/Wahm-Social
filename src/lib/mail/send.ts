import "server-only";
import { readSmtp, smtpConnectAttempts, smtpReady, type SmtpConfig } from "./config";
import { scrub } from "@/lib/server/errorLog";

export interface MailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Overrides the SMTP config display name for this message. */
  fromName?: string;
}

export interface SmtpTimeouts {
  connectionTimeout?: number;
  greetingTimeout?: number;
  socketTimeout?: number;
}

const DEFAULT_TIMEOUTS: Required<SmtpTimeouts> = {
  connectionTimeout: 8_000,
  greetingTimeout: 8_000,
  socketTimeout: 15_000,
};

async function sendOnce(
  m: MailInput,
  cfg: SmtpConfig,
  timeouts: Required<SmtpTimeouts>,
): Promise<{ messageId: string; fromAddress: string }> {
  const nodemailer = (await import("nodemailer")).default;
  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
    connectionTimeout: timeouts.connectionTimeout,
    greetingTimeout: timeouts.greetingTimeout,
    socketTimeout: timeouts.socketTimeout,
  });
  const fromAddr = cfg.fromAddress || cfg.user;
  const fromName = (m.fromName || cfg.fromName || "Frostly").replace(/"/g, "");
  const info = await transport.sendMail({
    from: fromName ? `"${fromName}" <${fromAddr}>` : fromAddr,
    to: m.to,
    replyTo: cfg.replyTo || undefined,
    subject: m.subject,
    text: m.text,
    html: m.html,
  });
  return { messageId: String(info.messageId ?? ""), fromAddress: fromAddr };
}

/** Send one email through the admin-configured SMTP server. Throws a short Arabic message on failure. */
export async function sendMail(
  m: MailInput,
  cfg: SmtpConfig = readSmtp(),
  timeouts: SmtpTimeouts = {},
): Promise<{ messageId: string; fromAddress: string }> {
  if (!smtpReady(cfg)) throw new Error("البريد (SMTP) غير مضبوط في لوحة التحكم");
  const t: Required<SmtpTimeouts> = { ...DEFAULT_TIMEOUTS, ...timeouts };
  const attempts = smtpConnectAttempts(cfg);
  let lastErr: unknown;
  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i];
    try {
      const r = await sendOnce(m, attempt, t);
      if (attempts.length > 1) {
        console.info(`[mail] smtp ok host=${attempt.host} port=${attempt.port} secure=${attempt.secure}`);
      }
      return r;
    } catch (e) {
      lastErr = e;
      const msg = scrub(String((e as Error)?.message ?? e));
      const more = i < attempts.length - 1;
      console.error(
        `[mail] smtp try host=${attempt.host} port=${attempt.port} secure=${attempt.secure} failed: ${msg}` +
          (more ? "; trying next port" : ""),
      );
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? "SMTP send failed"));
}

/** Public From address (never the password). */
export function smtpFromAddress(cfg: SmtpConfig = readSmtp()): string {
  return cfg.fromAddress || cfg.user || "";
}

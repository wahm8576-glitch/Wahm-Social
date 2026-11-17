/** SMTP settings, stored encrypted in the admin secrets bag (frostly-data) under `smtp_config`. */
import { snapshot } from "../site/snapshot";

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromName: string;
  fromAddress: string;
  replyTo: string;
}

export const SMTP_KEY = "smtp_config";

const EMPTY: SmtpConfig = { host: "", port: 587, secure: false, user: "", pass: "", fromName: "Frostly", fromAddress: "", replyTo: "" };

export function readSmtp(secrets: Record<string, string> = snapshot().secrets): SmtpConfig {
  try {
    const raw = secrets[SMTP_KEY];
    if (!raw) return { ...EMPTY };
    const o = JSON.parse(raw) as Partial<SmtpConfig>;
    return {
      host: String(o.host ?? ""),
      port: Number(o.port) || 587,
      secure: Boolean(o.secure),
      user: String(o.user ?? ""),
      pass: String(o.pass ?? ""),
      fromName: String(o.fromName ?? "Frostly"),
      fromAddress: String(o.fromAddress ?? ""),
      replyTo: String(o.replyTo ?? ""),
    };
  } catch {
    return { ...EMPTY };
  }
}

export const smtpReady = (c = readSmtp()) => Boolean(c.host && c.port && (c.fromAddress || c.user));

/** Safe view for the panel: never includes the password. */
export function smtpPublic(c = readSmtp()) {
  const { pass, ...rest } = c;
  return { ...rest, hasPass: Boolean(pass), passLen: pass.length };
}

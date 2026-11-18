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

/** Safe one-line SMTP status for logs — never includes the password or a full address if you don't need it. */
export function smtpDiag(c = readSmtp()): string {
  const host = String(c.host || "").replace(/^.*@/, "").split("/")[0].slice(0, 80) || "none";
  return `ready=${smtpReady(c)} host=${host} port=${c.port} secure=${c.secure} hasUser=${Boolean(c.user)} hasFrom=${Boolean(c.fromAddress)} hasPass=${Boolean(c.pass)}`;
}

/** Safe view for the panel: never includes the password. */
export function smtpPublic(c = readSmtp()) {
  const { pass, ...rest } = c;
  return { ...rest, hasPass: Boolean(pass), passLen: pass.length };
}

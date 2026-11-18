import "server-only";
import { env } from "@/lib/env";
import { scrub } from "@/lib/server/errorLog";
import type { MailInput } from "./send";
import { buildBrevoPayload } from "./brevo-payload";
export { buildBrevoPayload };

export function brevoReady(): boolean {
  return Boolean(env.brevoApiKey && env.brevoSenderEmail.includes("@"));
}

/** Safe one-liner — never includes the API key. */
export function brevoDiag(): string {
  return `ready=${brevoReady()} senderSet=${Boolean(env.brevoSenderEmail)} hasKey=${Boolean(env.brevoApiKey)}`;
}

/** Send one transactional email through Brevo's HTTPS API. */
export async function sendBrevo(m: MailInput): Promise<{ messageId: string; fromAddress: string }> {
  if (!brevoReady()) throw new Error("Brevo is not configured");
  const fromAddress = env.brevoSenderEmail;
  const senderName = m.fromName || env.brevoSenderName || "Frostly | فروستلي";
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": env.brevoApiKey, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(buildBrevoPayload(m, fromAddress, senderName)),
  });
  const j = (await r.json().catch(() => ({}))) as { messageId?: string; message?: string; code?: string };
  if (!r.ok) {
    const err = scrub(String(j.message || j.code || r.status));
    throw new Error(`Brevo HTTP ${r.status}: ${err}`);
  }
  return { messageId: String(j.messageId ?? ""), fromAddress };
}

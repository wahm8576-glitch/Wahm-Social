import "server-only";
import { env } from "@/lib/env";
import { scrub } from "@/lib/server/errorLog";
import { brevoDiag, brevoReady, sendBrevo } from "./brevo";
import { smtpDiag, smtpReady } from "./config";
import { sendMail, type MailInput } from "./send";

export type BrandedMailPath = "brevo" | "smtp";

export interface DeliveredMail {
  path: BrandedMailPath;
  messageId: string;
  fromAddress: string;
}

/**
 * Branded mail transport: Brevo HTTPS first, then SMTP (skipped quickly on Render,
 * where outbound 587/465 are blocked), otherwise throw for the caller to fall back.
 */
export async function deliverBrandedMail(m: MailInput): Promise<DeliveredMail> {
  if (brevoReady()) {
    try {
      const r = await sendBrevo(m);
      return { path: "brevo", messageId: r.messageId, fromAddress: r.fromAddress };
    } catch (e) {
      console.error(`[mail] brevo failed (${brevoDiag()}): ${scrub(String((e as Error)?.message ?? e))}`);
    }
  }
  if (smtpReady()) {
    if (env.onRender) {
      console.error(`[mail] smtp skipped (render blocks outbound smtp; ${smtpDiag()})`);
    } else {
      const r = await sendMail(m, undefined, { connectionTimeout: 8_000, greetingTimeout: 8_000, socketTimeout: 15_000 });
      return { path: "smtp", messageId: r.messageId, fromAddress: r.fromAddress };
    }
  }
  throw new Error(
    brevoReady() ? "Brevo failed and SMTP is unavailable" : "No branded mail transport (Brevo/SMTP)",
  );
}

export function brandedTransportReady(): boolean {
  return brevoReady() || smtpReady();
}

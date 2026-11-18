/**
 * Ask Firebase to send its own OOB email (password reset / email verification)
 * when our SMTP path is unavailable. Never reveals whether the address exists.
 */
import { readServiceAccount, readWebConfig } from "./config";
import { adminApp } from "./admin";
import { scrub } from "@/lib/server/errorLog";

export type OobRequestType = "PASSWORD_RESET" | "VERIFY_EMAIL";
export type OobResult = "sent" | "not-found";

const NOT_FOUND = new Set(["EMAIL_NOT_FOUND", "USER_NOT_FOUND", "USER_DISABLED"]);

function errorCode(j: unknown, status: number): string {
  const err = (j as { error?: { message?: string; status?: string } })?.error;
  const raw = String(err?.message || err?.status || status);
  return raw.split(":")[0].replace(/[^A-Z0-9_]/g, "").slice(0, 60) || String(status);
}

async function accessToken(): Promise<string> {
  const app = await adminApp();
  const cred = app.options.credential;
  if (!cred?.getAccessToken) throw new Error("Firebase credential cannot mint an access token");
  const t = await cred.getAccessToken();
  if (!t?.access_token) throw new Error("Firebase access token empty");
  return t.access_token;
}

/** Public Identity Toolkit endpoint (same one the Firebase client SDK uses). */
async function sendOobWithApiKey(email: string, requestType: OobRequestType, continueUrl: string): Promise<OobResult> {
  const apiKey = readWebConfig().apiKey;
  if (!apiKey) throw new Error("Firebase API key missing");
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestType, email, continueUrl, canHandleCodeInApp: false }),
  });
  const j = await r.json().catch(() => ({}));
  if (r.ok) return "sent";
  const code = errorCode(j, r.status);
  if (NOT_FOUND.has(code)) return "not-found";
  throw new Error(`Firebase oob ${code}`);
}

/** Admin Identity Toolkit endpoint — needed for VERIFY_EMAIL without an idToken. */
async function sendOobWithAdmin(email: string, requestType: OobRequestType, continueUrl: string): Promise<OobResult> {
  const sa = readServiceAccount();
  if (!sa) throw new Error("Firebase service account is not configured");
  const token = await accessToken();
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(sa.projectId)}/accounts:sendOobCode`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ requestType, email, continueUrl, returnOobLink: false }),
  });
  const j = await r.json().catch(() => ({}));
  if (r.ok) return "sent";
  const code = errorCode(j, r.status);
  if (NOT_FOUND.has(code)) return "not-found";
  throw new Error(`Firebase admin oob ${code}`);
}

/**
 * Trigger Firebase to email the user. PASSWORD_RESET uses the public API key;
 * VERIFY_EMAIL uses the admin API (idToken is not required).
 * Missing users are reported as not-found, never thrown.
 */
export async function sendFirebaseOobEmail(email: string, requestType: OobRequestType, continueUrl: string): Promise<OobResult> {
  try {
    if (requestType === "VERIFY_EMAIL") return await sendOobWithAdmin(email, requestType, continueUrl);
    return await sendOobWithApiKey(email, requestType, continueUrl);
  } catch (e) {
    const msg = scrub(String((e as Error)?.message ?? e));
    if (requestType === "PASSWORD_RESET") {
      // One retry via the admin endpoint if the public API is blocked or rejected.
      try {
        return await sendOobWithAdmin(email, requestType, continueUrl);
      } catch (e2) {
        throw new Error(scrub(String((e2 as Error)?.message ?? e2)));
      }
    }
    throw new Error(msg);
  }
}

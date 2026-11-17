/**
 * Firebase Authentication settings. Stored encrypted in the admin secrets bag (frostly-data):
 *   firebase_web             → JSON of the public web config (apiKey, authDomain, projectId, appId, …)
 *   firebase_service_account → service-account JSON (server only, never sent to the browser)
 *   firebase_enabled         → "1" to switch site auth to Firebase
 * Env fallbacks: NEXT_PUBLIC_FIREBASE_* and FIREBASE_SERVICE_ACCOUNT, FIREBASE_AUTH_ENABLED.
 * When anything required is missing, the site keeps using its own email/password auth unchanged.
 */
import { snapshot } from "../site/snapshot";

export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  messagingSenderId?: string;
  storageBucket?: string;
  measurementId?: string;
}

export interface ServiceAccountInfo {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

export const FB_WEB_KEY = "firebase_web";
export const FB_SA_KEY = "firebase_service_account";
export const FB_ENABLED_KEY = "firebase_enabled";

const WEB_FIELDS = ["apiKey", "authDomain", "projectId", "appId", "messagingSenderId", "storageBucket", "measurementId"] as const;
const ENV_NAMES: Record<(typeof WEB_FIELDS)[number], string> = {
  apiKey: "NEXT_PUBLIC_FIREBASE_API_KEY",
  authDomain: "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  projectId: "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  appId: "NEXT_PUBLIC_FIREBASE_APP_ID",
  messagingSenderId: "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  storageBucket: "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
  measurementId: "NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID",
};

const sec = (s?: Record<string, string>) => s ?? snapshot().secrets ?? {};

export function readWebConfig(secrets?: Record<string, string>): FirebaseWebConfig {
  let stored: Record<string, unknown> = {};
  try {
    stored = JSON.parse(sec(secrets)[FB_WEB_KEY] || "{}");
  } catch {}
  const out: Record<string, string> = {};
  for (const f of WEB_FIELDS) out[f] = String(stored[f] ?? process.env[ENV_NAMES[f]] ?? "").trim();
  return out as unknown as FirebaseWebConfig;
}

/** Parses a service-account JSON; returns null when it is not a usable key. */
export function parseServiceAccount(raw: string): ServiceAccountInfo | null {
  try {
    const j = JSON.parse(raw);
    const privateKey = String(j.private_key ?? "").replace(/\\n/g, "\n");
    const info = { projectId: String(j.project_id ?? ""), clientEmail: String(j.client_email ?? ""), privateKey };
    if (!info.projectId || !/@/.test(info.clientEmail) || !/BEGIN (RSA )?PRIVATE KEY/.test(privateKey)) return null;
    return info;
  } catch {
    return null;
  }
}

export function readServiceAccount(secrets?: Record<string, string>): ServiceAccountInfo | null {
  const raw = sec(secrets)[FB_SA_KEY] || process.env.FIREBASE_SERVICE_ACCOUNT || "";
  return raw ? parseServiceAccount(raw) : null;
}

export const webConfigComplete = (c: FirebaseWebConfig) => Boolean(c.apiKey && c.authDomain && c.projectId && c.appId);

export function firebaseSwitch(secrets?: Record<string, string>): boolean {
  const v = sec(secrets)[FB_ENABLED_KEY] ?? process.env.FIREBASE_AUTH_ENABLED ?? "";
  return v === "1" || v === "true";
}

/** Firebase auth is live only when switched on AND both configs are present and match the same project. */
export function firebaseEnabled(secrets?: Record<string, string>): boolean {
  if (!firebaseSwitch(secrets)) return false;
  const web = readWebConfig(secrets);
  const sa = readServiceAccount(secrets);
  return webConfigComplete(web) && !!sa && sa.projectId === web.projectId;
}

/** What the browser needs (public by design) — null when Firebase auth is off. */
export function clientFirebaseConfig(secrets?: Record<string, string>): FirebaseWebConfig | null {
  if (!firebaseEnabled(secrets)) return null;
  const c = readWebConfig(secrets);
  const out: FirebaseWebConfig = { apiKey: c.apiKey, authDomain: c.authDomain, projectId: c.projectId, appId: c.appId };
  if (c.messagingSenderId) out.messagingSenderId = c.messagingSenderId;
  if (c.storageBucket) out.storageBucket = c.storageBucket;
  return out;
}

/** Status for the admin panel: never includes the private key. */
export function firebaseStatus(secrets?: Record<string, string>) {
  const web = readWebConfig(secrets);
  const sa = readServiceAccount(secrets);
  const rawSa = sec(secrets)[FB_SA_KEY] ? "panel" : process.env.FIREBASE_SERVICE_ACCOUNT ? "env" : "";
  return {
    web,
    webComplete: webConfigComplete(web),
    sa: sa ? { projectId: sa.projectId, clientEmail: sa.clientEmail, source: rawSa } : null,
    saStoredButInvalid: !sa && !!rawSa,
    projectMismatch: !!sa && webConfigComplete(web) && sa.projectId !== web.projectId,
    switchOn: firebaseSwitch(secrets),
    enabled: firebaseEnabled(secrets),
  };
}

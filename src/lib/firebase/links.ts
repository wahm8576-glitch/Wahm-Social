/** Pure helpers around Firebase action / oob links (safe to unit-test). */

/** Pull the one-time `oobCode` out of a Firebase-generated action URL. */
export function extractOobCode(link: string): string | null {
  try {
    const u = new URL(link);
    const code = u.searchParams.get("oobCode")?.trim() || "";
    return code.length >= 8 ? code : null;
  } catch {
    return null;
  }
}

/** Display name for greetings: Firebase/Firestore name, else the email local-part. */
export function greetingName(displayName: string | undefined | null, email: string): string {
  const n = (displayName || "").trim();
  if (n) return n.slice(0, 80);
  const local = email.split("@")[0]?.trim() || "";
  return local.slice(0, 80) || "ضيفنا";
}

export function siteResetUrl(origin: string, oobCode: string): string {
  return `${origin.replace(/\/$/, "")}/reset-password?oobCode=${encodeURIComponent(oobCode)}`;
}

export function siteVerifyUrl(origin: string, oobCode: string): string {
  return `${origin.replace(/\/$/, "")}/verify-email?oobCode=${encodeURIComponent(oobCode)}`;
}

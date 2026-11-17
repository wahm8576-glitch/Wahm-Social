import { env } from "../env";
import { firebaseEnabled } from "../firebase/config";
import type { User } from "./db";

/**
 * The in-app admin role comes only from ADMIN_EMAILS (no "first user" rule).
 * With Firebase on, the email must also be verified, so nobody can claim an admin address with a password signup.
 */
export function roleFor(u: Pick<User, "email" | "emailVerified">): User["role"] {
  if (!env.adminEmails.includes(u.email.toLowerCase())) return "user";
  return u.emailVerified === true || !firebaseEnabled() ? "admin" : "user";
}

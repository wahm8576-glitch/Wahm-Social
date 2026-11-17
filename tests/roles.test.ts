import { test } from "node:test";
import assert from "node:assert/strict";
import { roleFor } from "../src/lib/server/roles";

test("admin role only for ADMIN_EMAILS (verified when Firebase is on)", () => {
  process.env.ADMIN_EMAILS = "Boss@Example.com, other@example.com";
  delete process.env.FIREBASE_AUTH_ENABLED;
  assert.equal(roleFor({ email: "random@example.com" }), "user");
  assert.equal(roleFor({ email: "boss@example.com" }), "admin", "legacy mode: listed email");
  // Firebase on (env config): unverified listed email is NOT admin.
  process.env.FIREBASE_AUTH_ENABLED = "1";
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY = "k";
  process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = "p.firebaseapp.com";
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "p";
  process.env.NEXT_PUBLIC_FIREBASE_APP_ID = "1:2:web:3";
  const { generateKeyPairSync } = require("node:crypto");
  const pk = generateKeyPairSync("rsa", { modulusLength: 1024 }).privateKey.export({ type: "pkcs8", format: "pem" });
  process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ project_id: "p", client_email: "a@p.iam", private_key: pk });
  assert.equal(roleFor({ email: "boss@example.com", emailVerified: false }), "user");
  assert.equal(roleFor({ email: "boss@example.com", emailVerified: true }), "admin");
  assert.equal(roleFor({ email: "random@example.com", emailVerified: true }), "user");
  for (const k of ["ADMIN_EMAILS", "FIREBASE_AUTH_ENABLED", "NEXT_PUBLIC_FIREBASE_API_KEY", "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", "NEXT_PUBLIC_FIREBASE_PROJECT_ID", "NEXT_PUBLIC_FIREBASE_APP_ID", "FIREBASE_SERVICE_ACCOUNT"]) delete process.env[k];
});

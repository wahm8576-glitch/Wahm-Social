import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { clientFirebaseConfig, firebaseEnabled, firebaseStatus, parseServiceAccount } from "../src/lib/firebase/config";

const pk = generateKeyPairSync("rsa", { modulusLength: 1024 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const sa = (projectId = "demo-proj") => JSON.stringify({ type: "service_account", project_id: projectId, client_email: `x@${projectId}.iam.gserviceaccount.com`, private_key: pk });
const web = JSON.stringify({ apiKey: "AIzaTest", authDomain: "demo-proj.firebaseapp.com", projectId: "demo-proj", appId: "1:2:web:3" });

test("Firebase stays off unless switched on with complete, matching configs", () => {
  assert.equal(firebaseEnabled({}), false);
  assert.equal(firebaseEnabled({ firebase_web: web, firebase_service_account: sa() }), false, "switch off");
  assert.equal(firebaseEnabled({ firebase_enabled: "1", firebase_web: web }), false, "no service account");
  assert.equal(firebaseEnabled({ firebase_enabled: "1", firebase_web: web, firebase_service_account: sa("other") }), false, "project mismatch");
  assert.equal(firebaseEnabled({ firebase_enabled: "1", firebase_web: web, firebase_service_account: sa() }), true);
});

test("client config never contains service-account data", () => {
  const s = { firebase_enabled: "1", firebase_web: web, firebase_service_account: sa() };
  const c = clientFirebaseConfig(s);
  assert.ok(c);
  assert.deepEqual(Object.keys(c!).sort(), ["apiKey", "appId", "authDomain", "projectId"]);
  assert.ok(!JSON.stringify(firebaseStatus(s)).includes("PRIVATE KEY"));
  assert.equal(clientFirebaseConfig({ firebase_web: web }), null);
});

test("parseServiceAccount rejects junk and accepts escaped newlines", () => {
  assert.equal(parseServiceAccount("{}"), null);
  assert.equal(parseServiceAccount("not json"), null);
  const escaped = JSON.stringify({ project_id: "p", client_email: "a@b.c", private_key: pk.replace(/\n/g, "\\n") });
  assert.ok(parseServiceAccount(escaped)?.privateKey.includes("\n"));
});

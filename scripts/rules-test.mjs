#!/usr/bin/env node

/**
 * Tests firestore.rules against every path the client uses (ALLOW) and every
 * attack we know of (DENY), through the Firebase Rules API `:test` endpoint.
 * It only evaluates the rules sent with the request: nothing is published and
 * no data is read or written.
 *
 * Usage:
 *   pnpm test:rules
 *   node scripts/rules-test.mjs [--rules path/to/firestore.rules] [--payload-out out.json]
 *
 * Needs `gcloud` signed in with access to the project (RULES_PROJECT, default
 * execute-todo-1d3bc). Exits 1 if any case does not get the expected result.
 *
 * The client paths come from src/sync/v2/firestoreStore.ts, the only module
 * that talks to Firestore: listen (onSnapshot + a one-shot getDocs, both a
 * `list`), and commit (a plain batch, or a transaction whose tx.get is a `get`;
 * set is a `create` or an `update`, patch an `update`). What the desktop
 * (src/sync/v2/engine.ts) and the phone (src/sync/v2/viewer.ts) do with them
 * is listed case by case below. When the client starts using a new collection,
 * meta document or operation, add it here and to firestore.rules together.
 */

import { execFileSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT = process.env.RULES_PROJECT ?? "execute-todo-1d3bc";

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const RULES_PATH = resolve(argValue("--rules") ?? resolve(__dirname, "../firestore.rules"));
const PAYLOAD_OUT = argValue("--payload-out");

const OWNER = "ownerUid";
const EVIL = "evilUid";
const OWNER_EMAIL = "maxiredigonda@gmail.com";
const DB = "/databases/(default)/documents";

function token(uid, email, { verified = true, provider = "google.com", omitVerified = false } = {}) {
  const claims = { firebase: { sign_in_provider: provider } };
  if (email != null) {
    claims.email = email;
    if (!omitVerified) claims.email_verified = verified;
  }
  return { uid, token: claims };
}

// The desktop signs in with signInWithCredential(GoogleAuthProvider.credential)
// and the phone with signInWithPopup(GoogleAuthProvider): both are google.com.
const AS_OWNER = token(OWNER, OWNER_EMAIL);
const OUTSIDERS = [
  ["another Google account", token(EVIL, "stranger@gmail.com")],
  ["an anonymous session", { uid: "anonUid", token: { firebase: { sign_in_provider: "anonymous" } } }],
  ["no session", null],
  ["the owner's email, unverified, password provider", token(EVIL, OWNER_EMAIL, { verified: false, provider: "password" })],
  ["the owner's email, verified, password provider", token(EVIL, OWNER_EMAIL, { provider: "password" })],
  ["the owner's email without an email_verified claim", token(EVIL, OWNER_EMAIL, { omitVerified: true })],
  ["the owner's email in another case", token(EVIL, "MaxiRedigonda@gmail.com")],
  ["the owner's email in a token for another uid", token(EVIL, OWNER_EMAIL)],
  ["the owner's uid and email from another provider", token(OWNER, OWNER_EMAIL, { provider: "github.com" })],
];

const user = (uid, rest) => `${DB}/users/${uid}/${rest}`;

// Document shapes as src/sync/docs.ts writes them. The rules don't look at
// field values, so these only need to be plausible.
const TASK = {
  text: "pay rent",
  notes: "",
  completed: false,
  completedAt: null,
  plannedFor: "2026-10-20",
  projectId: "project-inbox",
  parentId: null,
  rank: "a0",
  trashedAt: null,
  createdAt: 1792000000000,
  updatedAt: 1792000000000,
  movedAt: 1792000000000,
  clocks: { text: 1792000000000, status: 1792000000000 },
};
const ITEMS = {
  tasks: TASK,
  projects: { name: "Inbox", color: "slate", createdAt: 1, updatedAt: 1 },
  recurrences: { template: { text: "water plants" }, rule: { kind: "daily" }, createdAt: 1, updatedAt: 1 },
  habits: { name: "Stretch", perWeek: 7, checks: { "2026-10-19": "done" }, checkedAt: { "2026-10-19": 1 }, notes: {}, values: {}, createdAt: 1, updatedAt: 1 },
  tombstones: { deletedAt: 1792000000000, purged: false },
  days: { committed: 3, finished: 2, closedAt: null },
};
const META = {
  state: { schemaVersion: 25, lastOpenedDate: "2026-10-20" },
  format: { version: 2, migratedAt: 1790000000000, v1Frozen: true },
  heartbeat: { at: 1792000000000 },
};
const LOG = { taskId: "t1", taskText: "pay rent", action: "completed", reason: "no time", at: 1792000000000, date: "2026-10-20" };
const V1 = { schemaVersion: 1000, tasks: [] };

const ALLOW = "ALLOW";
const DENY = "DENY";

function testCase(id, description, expectation, { auth, path, method, write, existing }) {
  const request = { path, method };
  if (auth != null) request.auth = auth;
  if (write != null) request.resource = { data: write };
  const tc = { expectation, request };
  if (existing != null) tc.resource = { data: existing };
  return { id, description, tc };
}

const CASES = [];
const add = (...args) => CASES.push(testCase(...args));

// ── Every client path (ALLOW) ──────────────────────────────────────────
for (const [coll, doc] of Object.entries(ITEMS)) {
  const path = user(OWNER, `${coll}/x1`);
  add(`L-${coll}-list`, `desktop listens to ${coll} (onSnapshot / one-shot getDocs)`, ALLOW, { auth: AS_OWNER, path, method: "list" });
  add(`L-${coll}-get`, `guarded transaction reads ${coll}/x1 (tx.get)`, ALLOW, { auth: AS_OWNER, path, method: "get", existing: doc });
  add(`L-${coll}-get0`, `guarded transaction reads a missing ${coll}/x1 (expect not exists)`, ALLOW, { auth: AS_OWNER, path, method: "get" });
  add(`L-${coll}-create`, `a new ${coll} document (batch or transaction set)`, ALLOW, { auth: AS_OWNER, path, method: "create", write: doc });
  add(`L-${coll}-update`, `an existing ${coll} document set whole or patched`, ALLOW, { auth: AS_OWNER, path, method: "update", write: { ...doc, updatedAt: 2 }, existing: doc });
  add(`L-${coll}-delete`, `desktop clean-up deletes junk or an expired ${coll} document`, ALLOW, { auth: AS_OWNER, path, method: "delete", existing: doc });
}
add("L-phone-open", "phone listens to tasks where completed == false", ALLOW, { auth: AS_OWNER, path: user(OWNER, "tasks/q"), method: "list" });
add("L-phone-recent", "phone listens to tasks where completedAt >= 14 days ago", ALLOW, { auth: AS_OWNER, path: user(OWNER, "tasks/q"), method: "list" });
add("L-phone-habits", "phone listens to habits and checks one in (tx.get + patch)", ALLOW, { auth: AS_OWNER, path: user(OWNER, "habits/h1"), method: "update", write: ITEMS.habits, existing: ITEMS.habits });
add("L-phone-capture", "phone captures a task (transaction set, expected missing)", ALLOW, { auth: AS_OWNER, path: user(OWNER, "tasks/new1"), method: "create", write: TASK });
add("L-log-create", "desktop sends a log line (blind batch set)", ALLOW, { auth: AS_OWNER, path: user(OWNER, "log/l1"), method: "create", write: LOG });
add("L-log-update", "desktop sends a log line again after a failed round", ALLOW, { auth: AS_OWNER, path: user(OWNER, "log/l1"), method: "update", write: LOG, existing: LOG });
add("L-log-list", "desktop reads the log back from its newest line (where at >= …)", ALLOW, { auth: AS_OWNER, path: user(OWNER, "log/q"), method: "list" });
add("L-meta-list", "both clients listen to meta", ALLOW, { auth: AS_OWNER, path: user(OWNER, "meta/state"), method: "list" });
for (const [id, doc] of Object.entries(META)) {
  const path = user(OWNER, `meta/${id}`);
  add(`L-meta-${id}-get`, `guarded transaction reads meta/${id}`, ALLOW, { auth: AS_OWNER, path, method: "get", existing: doc });
  add(`L-meta-${id}-get0`, `guarded transaction reads meta/${id} before it exists`, ALLOW, { auth: AS_OWNER, path, method: "get" });
  add(`L-meta-${id}-create`, `desktop writes meta/${id} the first time`, ALLOW, { auth: AS_OWNER, path, method: "create", write: doc });
  add(`L-meta-${id}-update`, `desktop sets or patches meta/${id}`, ALLOW, { auth: AS_OWNER, path, method: "update", write: doc, existing: doc });
}
add("L-v1-get", "the owner reads the frozen v1 document (manual recovery)", ALLOW, { auth: AS_OWNER, path: user(OWNER, "data/appData"), method: "get", existing: V1 });

// ── Anyone but the owner (DENY) ────────────────────────────────────────
OUTSIDERS.forEach(([who, auth], i) => {
  const n = `X${i + 1}`;
  add(`${n}-list`, `${who} lists the owner's tasks`, DENY, { auth, path: user(OWNER, "tasks/x1"), method: "list" });
  add(`${n}-get`, `${who} reads an owner's task`, DENY, { auth, path: user(OWNER, "tasks/x1"), method: "get", existing: TASK });
  add(`${n}-update`, `${who} overwrites an owner's task`, DENY, { auth, path: user(OWNER, "tasks/x1"), method: "update", write: { ...TASK, text: "pwned" }, existing: TASK });
  add(`${n}-delete`, `${who} deletes an owner's task`, DENY, { auth, path: user(OWNER, "tasks/x1"), method: "delete", existing: TASK });
  add(`${n}-tomb`, `${who} plants a tombstone in the owner's data`, DENY, { auth, path: user(OWNER, "tombstones/x1"), method: "create", write: ITEMS.tombstones });
  add(`${n}-meta`, `${who} rewrites the owner's meta/state`, DENY, { auth, path: user(OWNER, "meta/state"), method: "update", write: { schemaVersion: 999999 }, existing: META.state });
  add(`${n}-log`, `${who} reads the owner's log`, DENY, { auth, path: user(OWNER, "log/q"), method: "list" });
  add(`${n}-v1`, `${who} reads the owner's v1 document`, DENY, { auth, path: user(OWNER, "data/appData"), method: "get", existing: V1 });
  // Under its own uid, a token with the owner's verified Google email is the
  // owner (Firebase keeps one account per email), so that case isn't an attack.
  const own = auth?.uid ?? "anyUid";
  const ownersGoogleEmail =
    auth?.token?.email === OWNER_EMAIL && auth.token.email_verified === true && auth.token.firebase.sign_in_provider === "google.com";
  if (own !== OWNER && !ownersGoogleEmail) {
    add(`${n}-own`, `${who} writes under its own uid`, DENY, { auth, path: user(own, "tasks/junk"), method: "create", write: TASK });
  }
});
add("X-root", "a root collection outside /users", DENY, { auth: AS_OWNER, path: `${DB}/junk/x`, method: "create", write: { a: 1 } });
add("X-enum", "the owner lists another user's tasks", DENY, { auth: AS_OWNER, path: user(EVIL, "tasks/x1"), method: "list" });

// ── What the owner's own session must not do: beyond the app (DENY) ────
add("O-v1-update", "overwrite the frozen v1 backup", DENY, { auth: AS_OWNER, path: user(OWNER, "data/appData"), method: "update", write: { tasks: [] }, existing: V1 });
add("O-v1-delete", "delete the frozen v1 backup", DENY, { auth: AS_OWNER, path: user(OWNER, "data/appData"), method: "delete", existing: V1 });
add("O-v1-create", "write another document in data/", DENY, { auth: AS_OWNER, path: user(OWNER, "data/other"), method: "create", write: V1 });
add("O-v1-list", "list data/ (the v1 document is get-only)", DENY, { auth: AS_OWNER, path: user(OWNER, "data/appData"), method: "list" });
add("O-meta-format", "delete meta/format (the phone would say 'Moving your data')", DENY, { auth: AS_OWNER, path: user(OWNER, "meta/format"), method: "delete", existing: META.format });
add("O-meta-state", "delete meta/state", DENY, { auth: AS_OWNER, path: user(OWNER, "meta/state"), method: "delete", existing: META.state });
add("O-meta-heartbeat", "delete meta/heartbeat", DENY, { auth: AS_OWNER, path: user(OWNER, "meta/heartbeat"), method: "delete", existing: META.heartbeat });
add("O-meta-other", "create an unknown meta document", DENY, { auth: AS_OWNER, path: user(OWNER, "meta/other"), method: "create", write: { a: 1 } });
add("O-log-delete", "delete a log line", DENY, { auth: AS_OWNER, path: user(OWNER, "log/l1"), method: "delete", existing: LOG });
add("O-junk", "create a collection the app doesn't use", DENY, { auth: AS_OWNER, path: user(OWNER, "junk/x"), method: "create", write: { blob: "x".repeat(1000) } });
add("O-junk-read", "read a collection the app doesn't use", DENY, { auth: AS_OWNER, path: user(OWNER, "junk/x"), method: "list" });
add("O-nested", "write a subcollection under a task", DENY, { auth: AS_OWNER, path: user(OWNER, "tasks/t1/sub/x"), method: "create", write: { a: 1 } });
add("O-nested-log", "write a subcollection under a log line", DENY, { auth: AS_OWNER, path: user(OWNER, "log/l1/sub/x"), method: "create", write: { a: 1 } });
add("O-userdoc", "write the users/{uid} document itself", DENY, { auth: AS_OWNER, path: `${DB}/users/${OWNER}`, method: "create", write: { a: 1 } });
add("O-userdoc-list", "list users/", DENY, { auth: AS_OWNER, path: `${DB}/users/${OWNER}`, method: "list" });

// ── Not blocked, by design (ALLOW) ─────────────────────────────────────
// The rules don't validate values. A cap on stamps or on schemaVersion would
// also refuse a legitimate write from a device whose clock runs ahead or from
// a newer build, and a refused write stops the desktop's whole sync until it
// is fixed. A planted far-future tombstone is out-stamped by Restore a backup
// (undo and redo stamp past a deletion record, whatever it says).
add("A-tomb-future", "the owner's session writes a tombstone dated far in the future", ALLOW, { auth: AS_OWNER, path: user(OWNER, "tombstones/x1"), method: "create", write: { deletedAt: 9e15, purged: false } });
add("A-schema", "the owner's session sets meta/state.schemaVersion very high", ALLOW, { auth: AS_OWNER, path: user(OWNER, "meta/state"), method: "update", write: { schemaVersion: 999999 }, existing: META.state });

async function main() {
  const rules = readFileSync(RULES_PATH, "utf8");
  const payload = {
    source: { files: [{ name: "firestore.rules", content: rules }] },
    testSuite: { testCases: CASES.map((c) => c.tc) },
  };
  if (PAYLOAD_OUT != null) writeFileSync(PAYLOAD_OUT, JSON.stringify(payload, null, 1));

  const accessToken = execFileSync("gcloud", ["auth", "print-access-token"], { encoding: "utf8" }).trim();
  const response = await fetch(`https://firebaserules.googleapis.com/v1/projects/${PROJECT}:test`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "x-goog-user-project": PROJECT,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  if (!response.ok) {
    console.error(`Rules API ${response.status}:`, JSON.stringify(body, null, 1).slice(0, 4000));
    process.exit(1);
  }
  if (body.issues != null && body.issues.length > 0) {
    console.error("The rules do not compile:", JSON.stringify(body.issues, null, 1));
    process.exit(1);
  }

  const results = body.testResults ?? [];
  let passed = 0;
  CASES.forEach((c, index) => {
    const state = results[index]?.state ?? "MISSING";
    if (state === "SUCCESS") passed += 1;
    const detail = state === "SUCCESS" ? "" : ` | ${(results[index]?.debugMessages ?? []).join("; ")}`;
    console.log(`${state === "SUCCESS" ? "ok  " : "FAIL"} ${c.id.padEnd(18)} ${c.tc.expectation.padEnd(5)} ${c.description}${detail}`);
  });
  console.log(`${passed}/${CASES.length} as expected (${RULES_PATH})`);
  if (passed !== CASES.length || results.length !== CASES.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

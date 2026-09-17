import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { authorizeAiceoRole } from "../artifacts/api-server/src/lib/aiceoAuthorization.ts";

const routes = readFileSync("artifacts/api-server/src/routes/aiceoControlPlane.ts", "utf8");
assert.match(routes, /router\.post\("\/aiceo\/tasks", privileged\("aiceo_operator"/);
assert.match(routes, /router\.post\("\/aiceo\/tasks\/:id\/execute", privileged\("aiceo_operator"/);
assert.match(routes, /router\.post\("\/aiceo\/tasks\/:id\/validate", privileged\("aiceo_validator"/);
assert.match(routes, /router\.post\("\/aiceo\/tasks\/:id\/owner-governance-approve", privileged\("aiceo_owner"/);
assert.match(routes, /router\.post\("\/aiceo\/operator\/kill-switch", privileged\("aiceo_owner"/);
assert.match(routes, /router\.post\("\/aiceo\/operator\/recovery-ack", privileged\("aiceo_owner"/);
assert.match(routes, /router\.post\("\/aiceo\/operator\/circuit-reset", privileged\("aiceo_owner"/);

const owner = {
  userId: "matrix-owner",
  sessionClaims: { metadata: { role: "aiceo_owner" } },
};
const operator = {
  userId: "matrix-operator",
  sessionClaims: { metadata: { role: "aiceo_operator" } },
};
const validator = {
  userId: "matrix-validator",
  sessionClaims: { public_metadata: { role: "aiceo_validator" } },
};
const unauthorized = { userId: null, sessionClaims: null };
const unprivileged = { userId: "matrix-user", sessionClaims: {} };
const conflicting = {
  userId: "matrix-conflict",
  sessionClaims: { roles: ["aiceo_owner", "aiceo_operator"] },
};
const revokedOwner = {
  userId: "matrix-revoked-owner",
  sessionClaims: { metadata: { role: "aiceo_owner" } },
  publicMetadata: {},
};

const allowed = (auth, role) => authorizeAiceoRole(auth, role).allowed;
assert.equal(allowed(operator, "aiceo_operator"), true, "operator submit/execute must be allowed");
assert.equal(allowed(owner, "aiceo_owner"), true, "owner governance approval and kill switch must be allowed");
assert.equal(allowed(revokedOwner, "aiceo_owner"), false, "current Clerk metadata revocation overrides stale Owner session claims");
assert.equal(allowed(operator, "aiceo_owner"), false, "operator cannot impersonate Owner governance authority");
assert.equal(allowed(owner, "aiceo_operator"), false, "Owner authority cannot silently inherit operator execution authority");
assert.equal(allowed(validator, "aiceo_operator"), false, "validator submit/execute must be rejected");
assert.equal(allowed(operator, "aiceo_validator"), false, "operator validate must be rejected");
assert.equal(allowed(validator, "aiceo_validator"), true, "validator validate must be allowed");
assert.equal(allowed(unauthorized, "aiceo_operator"), false, "unauthorized submit/execute must be rejected");
assert.equal(allowed(unauthorized, "aiceo_validator"), false, "unauthorized validate must be rejected");
assert.equal(allowed(unprivileged, "aiceo_operator"), false, "unprivileged submit/execute must be rejected");
assert.equal(allowed(unprivileged, "aiceo_validator"), false, "unprivileged validate must be rejected");
assert.equal(allowed(conflicting, "aiceo_operator"), false, "dual-role identity must not act as operator");
assert.equal(allowed(conflicting, "aiceo_owner"), false, "dual-role identity must not act as Owner");
assert.notEqual(operator.userId, validator.userId, "matrix identities must remain distinct");

console.log("AICEO permission matrix passed for route logic. Real Clerk claims integration remains a separate runtime proof.");
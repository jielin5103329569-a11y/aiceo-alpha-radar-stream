import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { authorizeAiceoRole } from "../artifacts/api-server/src/lib/aiceoAuthorization.ts";

const routes = readFileSync("artifacts/api-server/src/routes/aiceoControlPlane.ts", "utf8");
assert.match(routes, /router\.post\("\/aiceo\/tasks", privileged\("aiceo_operator"/);
assert.match(routes, /router\.post\("\/aiceo\/tasks\/:id\/execute", privileged\("aiceo_operator"/);
assert.match(routes, /router\.post\("\/aiceo\/tasks\/:id\/validate", privileged\("aiceo_validator"/);

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
  sessionClaims: { roles: ["aiceo_operator", "aiceo_validator"] },
};

const allowed = (auth, role) => authorizeAiceoRole(auth, role).allowed;
assert.equal(allowed(operator, "aiceo_operator"), true, "operator submit/execute must be allowed");
assert.equal(allowed(validator, "aiceo_operator"), false, "validator submit/execute must be rejected");
assert.equal(allowed(operator, "aiceo_validator"), false, "operator validate must be rejected");
assert.equal(allowed(validator, "aiceo_validator"), true, "validator validate must be allowed");
assert.equal(allowed(unauthorized, "aiceo_operator"), false, "unauthorized submit/execute must be rejected");
assert.equal(allowed(unauthorized, "aiceo_validator"), false, "unauthorized validate must be rejected");
assert.equal(allowed(unprivileged, "aiceo_operator"), false, "unprivileged submit/execute must be rejected");
assert.equal(allowed(unprivileged, "aiceo_validator"), false, "unprivileged validate must be rejected");
assert.equal(allowed(conflicting, "aiceo_operator"), false, "dual-role identity must not act as operator");
assert.equal(allowed(conflicting, "aiceo_validator"), false, "dual-role identity must not act as validator");
assert.notEqual(operator.userId, validator.userId, "matrix identities must remain distinct");

console.log("AICEO permission matrix passed for route logic. Real Clerk claims integration remains a separate runtime proof.");
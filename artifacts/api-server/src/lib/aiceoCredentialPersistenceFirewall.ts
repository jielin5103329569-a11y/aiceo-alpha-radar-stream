import { createHash } from "node:crypto";

export const AICEO_CREDENTIAL_FIREWALL_VERSION = "AICEO-CREDENTIAL-FIREWALL-1";

export type CredentialClassification =
  | "credential_field"
  | "credential_assignment"
  | "authorization_bearer"
  | "authorization_basic"
  | "credential_url"
  | "private_key"
  | "known_secret_format";

export type CredentialDetectionEvidence = {
  version: typeof AICEO_CREDENTIAL_FIREWALL_VERSION;
  classification: CredentialClassification;
  fieldPath: string;
  contentDigest: string;
  disposition: "rejected" | "redacted";
  productionAuthority: false;
};

const CREDENTIAL_KEYS = new Set([
  "password",
  "passwd",
  "pwd",
  "secret",
  "token",
  "accesstoken",
  "refreshtoken",
  "apitoken",
  "authtoken",
  "idtoken",
  "bearertoken",
  "accesskey",
  "secretkey",
  "xapikey",
  "xauthtoken",
  "apikey",
  "authorization",
  "credential",
  "credentials",
  "privatekey",
  "clientsecret",
  "cookie",
  "setcookie",
  "sessionid",
  "sessiontoken",
]);
const normalizeKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

const PATTERNS: Array<{ classification: CredentialClassification; expression: RegExp }> = [
  {
    classification: "private_key",
    expression: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/gi,
  },
  {
    classification: "authorization_bearer",
    expression: /\bBearer\s+[A-Za-z0-9._~+/-]{8,}={0,2}\b/gi,
  },
  {
    classification: "authorization_basic",
    expression: /\bAuthorization\s*:\s*Basic\s+[A-Za-z0-9+/]{12,}={0,2}\b/gi,
  },
  {
    classification: "credential_url",
    expression: /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^@\s/]+@[^\s]+/gi,
  },
  {
    classification: "known_secret_format",
    expression: /\b(?:sk-(?:live|test|proj)?-?[A-Za-z0-9_-]{12,}|rk_live_[A-Za-z0-9]{12,}|whsec_[A-Za-z0-9]{12,}|xai-[A-Za-z0-9_-]{12,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b/g,
  },
  {
    classification: "credential_assignment",
    expression: /\b(?:password|passwd|pwd|secret|access[_ -]?token|refresh[_ -]?token|api[_ -]?token|auth[_ -]?token|id[_ -]?token|bearer[_ -]?token|access[_ -]?key|secret[_ -]?key|x[_ -]?api[_ -]?key|x[_ -]?auth[_ -]?token|session[_ -]?(?:id|token)|token|api[_ -]?key|client[_ -]?secret|credential|set[_ -]?cookie|cookie)s?\b\s*(?:is|=|:)\s*["']?[^\s"',;}{\]]{6,}["']?/gi,
  },
];

const matchText = (value: string): { classification: CredentialClassification; matched: string } | null => {
  for (const pattern of PATTERNS) {
    pattern.expression.lastIndex = 0;
    const match = pattern.expression.exec(value);
    if (match) return { classification: pattern.classification, matched: match[0] };
  }
  return null;
};

const evidence = (
  value: unknown,
  fieldPath: string,
  classification: CredentialClassification,
  disposition: "rejected" | "redacted",
): CredentialDetectionEvidence => ({
  version: AICEO_CREDENTIAL_FIREWALL_VERSION,
  classification,
  fieldPath,
  contentDigest: digest(typeof value === "string" ? value : JSON.stringify(value)),
  disposition,
  productionAuthority: false,
});

export class AiceoCredentialPersistenceError extends Error {
  readonly safeEvidence: CredentialDetectionEvidence;

  constructor(safeEvidence: CredentialDetectionEvidence) {
    super(`AICEO credential persistence blocked: ${safeEvidence.classification} at ${safeEvidence.fieldPath}; digest=${safeEvidence.contentDigest}`);
    this.name = "AiceoCredentialPersistenceError";
    this.safeEvidence = safeEvidence;
  }
}

const inspect = (value: unknown, fieldPath: string, seen: WeakSet<object>): CredentialDetectionEvidence | null => {
  if (typeof value === "string") {
    const match = matchText(value);
    return match ? evidence(value, fieldPath, match.classification, "rejected") : null;
  }
  if (!value || typeof value !== "object" || value instanceof Date) return null;
  if (seen.has(value)) throw new AiceoCredentialPersistenceError(
    evidence("[circular]", fieldPath, "credential_field", "rejected"),
  );
  seen.add(value);
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = inspect(item, `${fieldPath}[${index}]`, seen);
      if (found) return found;
    }
    seen.delete(value);
    return null;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${fieldPath}.${key}`;
    if (CREDENTIAL_KEYS.has(normalizeKey(key)) && item != null && item !== "") {
      return evidence(item, childPath, "credential_field", "rejected");
    }
    const found = inspect(item, childPath, seen);
    if (found) return found;
  }
  seen.delete(value);
  return null;
};

export const assertCredentialPersistenceSafe = (value: unknown, surface: string): void => {
  const found = inspect(value, surface, new WeakSet());
  if (found) throw new AiceoCredentialPersistenceError(found);
};

export const sanitizeProviderOutputForPersistence = (value: string, surface: string) => {
  let sanitized = value;
  const detections: CredentialDetectionEvidence[] = [];
  for (const pattern of PATTERNS) {
    pattern.expression.lastIndex = 0;
    sanitized = sanitized.replace(pattern.expression, (matched) => {
      detections.push(evidence(matched, surface, pattern.classification, "redacted"));
      return `[REDACTED:${pattern.classification.toUpperCase()}]`;
    });
  }
  return {
    value: sanitized,
    detections,
    originalDigest: digest(value),
    redacted: detections.length > 0,
  };
};

export const safeCredentialErrorMessage = (error: unknown): string => {
  if (error instanceof AiceoCredentialPersistenceError) return error.message;
  const raw = error instanceof Error ? error.message : String(error);
  return sanitizeProviderOutputForPersistence(raw, "error").value;
};
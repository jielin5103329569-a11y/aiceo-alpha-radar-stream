import type { RuntimeDiagnosticPayload, RuntimeSupervisorEvidence } from "@workspace/db";

export const DIAGNOSTIC_REDACTION = "[redacted]";

const SENSITIVE_KEY =
  /(authorization|cookie|credential|password|passwd|secret|session|signature|token|api[_-]?key|access[_-]?key|private[_-]?key)/i;
const MAX_DEPTH = 10;
const MAX_OBJECT_ENTRIES = 128;
const MAX_ARRAY_ITEMS = 64;
const MAX_STRING_LENGTH = 2_000;

export function sanitizeDiagnosticText(value: string, max = MAX_STRING_LENGTH): string {
  return value
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gi,
      DIAGNOSTIC_REDACTION,
    )
    .replace(
      /\b(?:set-cookie|cookie)\s*[:=]\s*[^\r\n]*/gi,
      `Cookie: ${DIAGNOSTIC_REDACTION}`,
    )
    .replace(/[\r\n]/g, " ")
    .replace(
      /\b(?:proxy-)?authorization\s*[:=]\s*(?:(?:Bearer|Basic|Digest)\s+)?[^\s,;]+/gi,
      `Authorization: ${DIAGNOSTIC_REDACTION}`,
    )
    .replace(
      /\b(x-api-key|api[_-]?key|access[_-]?key|secret[_-]?key|private[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|consumer[_-]?secret|webhook[_-]?secret|signing[_-]?secret|authorization|cookie|credential|password|passwd|secret|session|signature|token)\s*([:=])\s*(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi,
      (_match, key: string, separator: string) => `${key}${separator}${DIAGNOSTIC_REDACTION}`,
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, `Bearer ${DIAGNOSTIC_REDACTION}`)
    .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, DIAGNOSTIC_REDACTION)
    .replace(/\b(?:gh[pousr]_|github_pat_|xox[baprs]-|AIza|AKIA)[A-Za-z0-9_-]{8,}\b/g, DIAGNOSTIC_REDACTION)
    .replace(/\b(?:sk|pk|rk|db)[-_][A-Za-z0-9_-]{12,}\b/gi, DIAGNOSTIC_REDACTION)
    .replace(
      /([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^@\s/]+)@/gi,
      `$1${DIAGNOSTIC_REDACTION}:${DIAGNOSTIC_REDACTION}@`,
    )
    .replace(
      /([?&](?:access[_-]?token|refresh[_-]?token|api[_-]?key|authorization|client[_-]?secret|consumer[_-]?secret|credential|password|secret|signature|token)=)[^&#\s]*/gi,
      `$1${DIAGNOSTIC_REDACTION}`,
    )
    .slice(0, Math.max(0, max));
}

export function sanitizeDiagnosticValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return DIAGNOSTIC_REDACTION;
  if (typeof value === "string") return sanitizeDiagnosticText(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeDiagnosticValue(item, depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, MAX_OBJECT_ENTRIES)
        .map(([key, item]) => [
          sanitizeDiagnosticText(key, 96),
          SENSITIVE_KEY.test(key) ? DIAGNOSTIC_REDACTION : sanitizeDiagnosticValue(item, depth + 1),
        ]),
    );
  }
  return null;
}

export function sanitizeDiagnosticRecord(
  value: Record<string, string | number | boolean | null>,
): Record<string, string | number | boolean | null> {
  return sanitizeDiagnosticValue(value) as Record<string, string | number | boolean | null>;
}

export function sanitizeDiagnosticEvidence(evidence: RuntimeSupervisorEvidence): RuntimeSupervisorEvidence {
  return {
    summary: sanitizeDiagnosticText(evidence.summary, 320),
    componentState: sanitizeDiagnosticText(evidence.componentState, 80),
    details: sanitizeDiagnosticRecord(evidence.details),
  };
}

export function sanitizeDiagnosticPayload(payload: RuntimeDiagnosticPayload): RuntimeDiagnosticPayload {
  return sanitizeDiagnosticValue(payload) as RuntimeDiagnosticPayload;
}
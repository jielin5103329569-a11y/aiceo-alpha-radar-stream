export type AiceoRole = "aiceo_operator" | "aiceo_validator";

export type AiceoAuthContext = {
  userId: string | null | undefined;
  sessionClaims: Record<string, unknown> | null | undefined;
};

const metadataRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const stringValues = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

export const aiceoRolesFromClaims = (
  claims: Record<string, unknown> | null | undefined,
): Set<AiceoRole> => {
  const metadata = metadataRecord(claims?.metadata);
  const publicMetadata = metadataRecord(claims?.publicMetadata);
  const publicMetadataSnakeCase = metadataRecord(claims?.public_metadata);
  const values = [
    claims?.role,
    metadata?.role,
    publicMetadata?.role,
    publicMetadataSnakeCase?.role,
    ...stringValues(claims?.roles),
    ...stringValues(metadata?.roles),
    ...stringValues(publicMetadata?.roles),
    ...stringValues(publicMetadataSnakeCase?.roles),
  ];
  return new Set(values.filter(
    (value): value is AiceoRole =>
      value === "aiceo_operator" || value === "aiceo_validator",
  ));
};

export const authorizeAiceoRole = (
  auth: AiceoAuthContext,
  requiredRole: AiceoRole,
): { allowed: true; userId: string } | { allowed: false; status: 401 | 403; error: string } => {
  if (!auth.userId) {
    return { allowed: false, status: 401, error: "Authentication required." };
  }
  const roles = aiceoRolesFromClaims(auth.sessionClaims);
  if (roles.size !== 1 || !roles.has(requiredRole)) {
    return {
      allowed: false,
      status: 403,
      error: `ARCH-001 exclusive ${requiredRole} role required.`,
    };
  }
  return { allowed: true, userId: auth.userId };
};
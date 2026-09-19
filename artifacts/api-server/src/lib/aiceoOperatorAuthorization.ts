export function hasAiceoOperatorAuthority(privateMetadata: unknown): boolean {
  return Boolean(
    privateMetadata
    && typeof privateMetadata === "object"
    && (privateMetadata as Record<string, unknown>).aiceoOperator === true,
  );
}

export async function authorizeAiceoOperator(
  userId: string,
  getPrivateMetadata: (userId: string) => Promise<unknown>,
): Promise<boolean> {
  try {
    return hasAiceoOperatorAuthority(await getPrivateMetadata(userId));
  } catch {
    return false;
  }
}
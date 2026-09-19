export const AICEO_MAX_TOKENS_PER_ATTEMPT = 512;
export const AICEO_MAX_USD_PER_ATTEMPT = 0.025;

export function calculateAiceoReservation(
  maxRetries: number,
  supplied?: { estimatedTokens?: number; estimatedCalls?: number; estimatedUsd?: number },
) {
  const attempts = maxRetries + 1;
  const minimum = {
    tokens: AICEO_MAX_TOKENS_PER_ATTEMPT * attempts,
    calls: attempts,
    usd: AICEO_MAX_USD_PER_ATTEMPT * attempts,
  };
  if (
    (supplied?.estimatedTokens ?? minimum.tokens) < minimum.tokens
    || (supplied?.estimatedCalls ?? minimum.calls) < minimum.calls
    || (supplied?.estimatedUsd ?? minimum.usd) < minimum.usd
  ) {
    throw new Error("ARCH-001 budget cannot undercut the fixed request retry ceiling");
  }
  return {
    estimatedTokens: supplied?.estimatedTokens ?? minimum.tokens,
    estimatedCalls: supplied?.estimatedCalls ?? minimum.calls,
    estimatedUsd: supplied?.estimatedUsd ?? minimum.usd,
    minimum,
  };
}

export type SettledProviderError = Error & {
  settled: boolean;
  retryable: boolean;
  status?: number;
};

export type ProviderAttemptOutcome<T> =
  | { kind: "success"; result: T; attempt: number }
  | { kind: "gate-closed"; error: unknown; attempt: number; callsMade: number }
  | { kind: "failure"; error: SettledProviderError; attempt: number };

export async function withUnsettledTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  timeoutError: () => Error,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(timeoutError()), timeoutMs);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function guardClaimedExecution<T>(input: {
  run: () => Promise<T>;
  onUnexpected: (error: unknown) => Promise<T>;
}): Promise<T> {
  try {
    return await input.run();
  } catch (error) {
    return input.onUnexpected(error);
  }
}

export async function runSerialProviderAttempts<T>(input: {
  maxRetries: number;
  gate: (attempt: number) => Promise<void>;
  beforeCall: (attempt: number) => Promise<void>;
  call: (attempt: number) => Promise<T>;
  record: (attempt: number, result?: T, error?: SettledProviderError) => Promise<void>;
  classifyError: (error: unknown) => SettledProviderError;
}): Promise<ProviderAttemptOutcome<T>> {
  let callsMade = 0;
  for (let attempt = 1; attempt <= input.maxRetries + 1; attempt += 1) {
    try {
      await input.gate(attempt);
    } catch (error) {
      return { kind: "gate-closed", error, attempt, callsMade };
    }
    let result: T;
    try {
      await input.beforeCall(attempt);
      callsMade += 1;
      result = await input.call(attempt);
    } catch (error) {
      const classified = input.classifyError(error);
      await input.record(attempt, undefined, classified);
      if (classified.settled && classified.retryable && attempt <= input.maxRetries) continue;
      return { kind: "failure", error: classified, attempt };
    }
    await input.record(attempt, result);
    return { kind: "success", result, attempt };
  }
  throw new Error("ARCH-001 provider attempt loop exhausted unexpectedly");
}
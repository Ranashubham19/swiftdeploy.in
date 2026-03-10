export type RateLimitDecision = {
  allowed: boolean;
  softLimited: boolean;
  retryAfterSeconds: number;
};

export const decideRateLimitAction = (
  input: { allowed: boolean; resetAt: Date },
  options?: { softMode?: boolean; nowMs?: number },
): RateLimitDecision => {
  if (input.allowed) {
    return { allowed: true, softLimited: false, retryAfterSeconds: 0 };
  }
  if (options?.softMode) {
    return { allowed: true, softLimited: true, retryAfterSeconds: 0 };
  }
  const nowMs = options?.nowMs ?? Date.now();
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((input.resetAt.getTime() - nowMs) / 1000),
  );
  return { allowed: false, softLimited: false, retryAfterSeconds };
};

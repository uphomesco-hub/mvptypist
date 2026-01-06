type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const WINDOW_MS = 60 * 60 * 1000;
const MAX_REQUESTS = 10;
const store = new Map<string, RateLimitEntry>();

export function rateLimit(ip: string) {
  const now = Date.now();
  const existing = store.get(ip);

  if (!existing || now > existing.resetAt) {
    const resetAt = now + WINDOW_MS;
    store.set(ip, { count: 1, resetAt });
    return {
      allowed: true,
      remaining: MAX_REQUESTS - 1,
      resetAt
    };
  }

  if (existing.count >= MAX_REQUESTS) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: existing.resetAt
    };
  }

  existing.count += 1;
  store.set(ip, existing);

  return {
    allowed: true,
    remaining: MAX_REQUESTS - existing.count,
    resetAt: existing.resetAt
  };
}

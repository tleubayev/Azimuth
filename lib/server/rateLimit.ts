/**
 * Best-effort, bounded in-memory fixed-window rate limiter.
 *
 * Used to put a ceiling on the public, unauthenticated endpoints (nonce
 * issuance, bridge quote proxy) so they can't be trivially flooded as a free
 * relay / CPU sink.
 *
 * NOTE: like any in-memory store on Vercel, this is PER-INSTANCE — it's a
 * defense-in-depth speed bump, not a global guarantee. Production should layer
 * an edge/CDN limiter (Vercel Firewall, or Upstash Ratelimit with a shared
 * store) in front. The map is hard-capped so the limiter itself can't grow
 * unbounded under a key-spray flood.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 50_000;

/** Drop only EXPIRED buckets — never an active one. */
function pruneExpired(now: number): void {
  for (const [k, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(k);
  }
}

export interface RateLimitResult {
  ok: boolean;
  retryAfterSeconds: number;
}

/** Allow at most `limit` hits per `windowMs` for `key`. */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    // New (or expired) key. If the map is saturated with *active* buckets we do
    // NOT evict them (a key-spray flood must not knock out legitimate users'
    // limits); instead, after reclaiming expired entries, fail closed for the
    // new key — reaching MAX_KEYS distinct active keys in one window is itself
    // a flood.
    if (!b && buckets.size >= MAX_KEYS) {
      pruneExpired(now);
      if (buckets.size >= MAX_KEYS) {
        return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil(windowMs / 1000)) };
      }
    }
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }
  b.count += 1;
  if (b.count > limit) {
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
  }
  return { ok: true, retryAfterSeconds: 0 };
}

/** Best-effort client IP from proxy headers (Vercel sets x-forwarded-for). */
export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

/** Build a 429 response with a Retry-After header. */
export function tooManyRequests(retryAfterSeconds: number): Response {
  return Response.json(
    { error: 'Too many requests.' },
    { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
  );
}

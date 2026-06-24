import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { serverSecret } from '@/lib/server/secret';

/**
 * Stateless, short-TTL nonce for ton_proof replay protection.
 *
 * The flow is: `GET /api/ton/nonce` calls {@link issue} to hand the client a
 * fresh value; the client passes it to TON Connect as the `tonProof` payload;
 * the wallet signs it; `POST /api/ton/verify` calls {@link consume} to validate
 * it. A nonce is valid only within {@link NONCE_TTL_MS}.
 *
 * Design — why stateless (not an in-process `Map`):
 * Vercel runs many isolated lambdas, so a nonce issued by one instance must be
 * verifiable by another. We therefore make the nonce a **self-authenticating,
 * expiring token**: `randomHex.expiryMs.HMAC(secret, randomHex.expiryMs)`.
 * Verification only needs the shared HMAC secret (env), so it works across
 * instances, never grows unbounded, and costs O(1) — fixing both the
 * cross-instance breakage and the O(n)-sweep / unbounded-growth DoS vector of
 * the old `Map`.
 *
 * Single-use: we additionally keep a *bounded* in-memory set of consumed tokens
 * to reject same-instance replays. Strict cross-instance single-use still needs
 * a shared atomic store (Redis/Upstash `GETDEL`); until then replay is bounded
 * by the 5-min token TTL *and* ton_proof's own ~15-min timestamp freshness check.
 *
 * PRODUCTION: set `NONCE_SECRET` (or rely on `TELEGRAM_BOT_TOKEN`) so the secret
 * is stable across all instances — {@link serverSecret} hard-fails in production
 * if neither is set (rather than silently degrading to a per-instance secret).
 */

/** How long an issued nonce stays valid, in milliseconds (5 minutes). */
export const NONCE_TTL_MS = 5 * 60 * 1000;

/** Random bytes embedded per nonce (192 bits of entropy). */
const NONCE_BYTES = 24;

/** Upper bound on the consumed-token set before opportunistic pruning. */
const CONSUMED_CAP = 10_000;

function sign(payload: string): string {
  return createHmac('sha256', serverSecret()).update(payload).digest('hex');
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

/** Bounded set of already-consumed tokens → unix-ms expiry (same-instance replay guard). */
const consumed = new Map<string, number>();

function rememberConsumed(token: string, expiresAt: number): void {
  if (consumed.size >= CONSUMED_CAP) {
    const now = Date.now();
    for (const [t, exp] of consumed) {
      if (exp <= now) consumed.delete(t);
    }
    // Still over cap after pruning expired? Drop oldest insertions until under it.
    while (consumed.size >= CONSUMED_CAP) {
      const oldest = consumed.keys().next().value;
      if (oldest === undefined) break;
      consumed.delete(oldest);
    }
  }
  consumed.set(token, expiresAt);
}

/**
 * Mint a fresh, self-authenticating, expiring nonce.
 * @returns `<randomHex>.<expiryMs>.<hmac>`.
 */
export function issue(): string {
  const expiresAt = Date.now() + NONCE_TTL_MS;
  const rnd = randomBytes(NONCE_BYTES).toString('hex');
  const payload = `${rnd}.${expiresAt}`;
  return `${payload}.${sign(payload)}`;
}

/**
 * Validate-and-burn a nonce.
 * @returns `true` iff the token has a valid signature, is unexpired, and has not
 *   already been consumed on this instance; `false` otherwise.
 */
export function consume(token: string): boolean {
  if (typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [rnd, expStr, sig] = parts;

  if (!safeEqualHex(sig, sign(`${rnd}.${expStr}`))) return false;

  const expiresAt = Number(expStr);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;

  if (consumed.has(token)) return false;
  rememberConsumed(token, expiresAt);
  return true;
}

/** Test-only helper to reset state between cases. Not used in production code. */
export function __clearNonceStoreForTests(): void {
  consumed.clear();
}

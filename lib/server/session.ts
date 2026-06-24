import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { serverSecret } from '@/lib/server/secret';

/**
 * httpOnly session-cookie helpers for the Mini App.
 *
 * The session is an **HMAC-signed** `<base64url(json)>.<sig>` token. `httpOnly`
 * stops client JS from reading it, but it does NOT stop an attacker from sending
 * a hand-crafted `Cookie:` header on a raw request — so the signature is what
 * makes the contents (e.g. the verified `tonAddress`) trustworthy when route
 * handlers gate on them. The cookie is marked:
 *   - `httpOnly`  — never readable from client JS.
 *   - `Secure`    — HTTPS only.
 *   - `SameSite=None; Partitioned` — required because the Mini App runs inside
 *     Telegram's WebView/iframe (a third-party/cross-site context). `None`
 *     allows the cookie to be sent from the embedded frame; `Partitioned`
 *     (CHIPS) keys it to the top-level Telegram site so modern browsers don't
 *     block it as a third-party cookie.
 *
 * The `next/headers` `cookies()` `set` API accepts `partitioned` natively, so
 * no cast is needed.
 */

/** Name of the session cookie. */
export const SESSION_COOKIE = 'compass_session';

/** Session lifetime in seconds (24h). */
const SESSION_MAX_AGE = 60 * 60 * 24;

/** The trusted identity we persist after verification. */
export interface SessionPayload {
  /** Telegram user id, set after `initData` verification. */
  telegramUserId?: number;
  /** Raw TON address ("0:abc…"), set after `ton_proof` verification. */
  tonAddress?: string;
  /** Unix-seconds issue time. */
  issuedAt: number;
}

/**
 * Cookie option bag including the `partitioned` (CHIPS) flag, which is not yet
 * part of the `next/headers` typed surface in this version.
 */
interface PartitionedCookieOptions {
  httpOnly: true;
  secure: true;
  sameSite: 'none';
  partitioned: true;
  path: string;
  maxAge: number;
}

function cookieOptions(): PartitionedCookieOptions {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    partitioned: true,
    path: '/',
    maxAge: SESSION_MAX_AGE,
  };
}

function sign(body: string): string {
  return createHmac('sha256', serverSecret()).update(body).digest('base64url');
}

/** Encode a payload as `<base64url(json)>.<hmac>`. */
function encode(payload: SessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${sign(body)}`;
}

/** Verify + decode a signed cookie value, or `null` if tampered/absent/corrupt. */
function decode(token: string): SessionPayload | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(body);
  if (sig.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    return typeof parsed.issuedAt === 'number' ? parsed : null;
  } catch {
    return null;
  }
}

/** Write (or overwrite) the signed session cookie. */
export async function setSession(payload: SessionPayload): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, encode(payload), cookieOptions());
}

/** Read, verify and parse the current session, or `null` if absent/invalid. */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  return decode(raw);
}

/** Delete the session cookie (logout). */
export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

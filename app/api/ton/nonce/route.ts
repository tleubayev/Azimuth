import { issue } from '@/lib/server/nonceStore';
import { clientIp, rateLimit, tooManyRequests } from '@/lib/server/rateLimit';

/**
 * GET /api/ton/nonce
 *
 * Issues a fresh nonce for ton_proof. The client feeds it to
 * `tonConnectUI.setConnectRequestParameters({ state: 'ready', value: { tonProof } })`
 * so the wallet signs it; `POST /api/ton/verify` then validates it.
 *
 * Nonces are stateless (HMAC-signed, see nonceStore) so this endpoint holds no
 * growing state; a per-IP rate limit caps flood abuse. Marked no-store so
 * intermediaries never cache a nonce.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(req: Request): Response {
  const { ok, retryAfterSeconds } = rateLimit(`nonce:${clientIp(req)}`, 30, 60_000);
  if (!ok) return tooManyRequests(retryAfterSeconds);

  const nonce = issue();
  return Response.json({ nonce }, { headers: { 'Cache-Control': 'no-store' } });
}

import { BridgeError, symbiosis } from '@/lib/bridge/symbiosis';
import {
  BridgeValidationError,
  buildSymbiosisQuoteParams,
  parseQuoteRequest,
} from '@/lib/bridge/quote-helper';
import type { BridgeQuoteResponse } from '@/lib/bridge/types';
import { clientIp, rateLimit, tooManyRequests } from '@/lib/server/rateLimit';
import { getSession } from '@/lib/server/session';

/**
 * POST /api/bridge/quote
 *
 * Validates the body, resolves the destination chain + USDC token from the
 * funding preset, then asks Symbiosis for a quote + TON-side transaction. The
 * partner id is injected server-side; the destination is the user's Privy EVM
 * address (passed in `toEvm`). Returns a {@link BridgeQuoteResponse}.
 *
 * This proxies a partner-attributed upstream, so it is per-IP rate limited to
 * avoid being used as a free relay. (Production should also gate it on a
 * verified session + an edge limiter — see docs/plans/.../05-bridge-funding-flow.md.)
 */
export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  const limit = rateLimit(`bridge-quote:${clientIp(req)}`, 20, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfterSeconds);

  // Require a verified (HMAC-signed) session so this partner-attributed upstream
  // can't be driven anonymously / across instances. The session is established
  // by /api/ton/verify (ton_proof) or /api/telegram/verify (initData), so a
  // caller must have proven a real Telegram/TON identity to get a quote.
  const session = await getSession();
  if (!session || (!session.tonAddress && session.telegramUserId == null)) {
    return Response.json(
      { error: 'Unauthorized — connect and verify your wallet first.' },
      { status: 401 },
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  let params;
  try {
    const parsed = parseQuoteRequest(raw);
    params = buildSymbiosisQuoteParams(parsed);
  } catch (err) {
    if (err instanceof BridgeValidationError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  try {
    const quote: BridgeQuoteResponse = await symbiosis.quote(params);
    return Response.json(quote);
  } catch (err) {
    if (err instanceof BridgeError) {
      // Surface upstream failures as 502 (bad gateway) without leaking secrets.
      return Response.json(
        { error: 'Bridge quote failed.', detail: err.message },
        { status: 502 },
      );
    }
    return Response.json({ error: 'Unexpected error building bridge quote.' }, { status: 500 });
  }
}

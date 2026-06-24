import { BridgeError, symbiosis } from '@/lib/bridge/symbiosis';
import {
  BridgeValidationError,
  buildSymbiosisWithdrawParams,
  parseWithdrawQuoteRequest,
} from '@/lib/bridge/quote-helper';
import type { BridgeQuoteResponse } from '@/lib/bridge/types';
import { clientIp, rateLimit, tooManyRequests } from '@/lib/server/rateLimit';
import { getSession } from '@/lib/server/session';

/**
 * POST /api/bridge/withdraw-quote
 *
 * The REVERSE of /api/bridge/quote: quotes USDC on the funding target's EVM
 * chain (the embedded wallet) → USD₮ on the user's TON wallet. Returns a
 * {@link BridgeQuoteResponse} whose `evmTransaction` the embedded wallet signs
 * to initiate the EVM→TON bridge. Same session + rate-limit gating as deposit.
 */
export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  const limit = rateLimit(`bridge-withdraw-quote:${clientIp(req)}`, 20, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfterSeconds);

  const session = await getSession();
  if (!session || (!session.tonAddress && session.telegramUserId == null)) {
    return Response.json({ error: 'Unauthorized — connect and verify your wallet first.' }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  let parsed;
  try {
    parsed = parseWithdrawQuoteRequest(raw);
  } catch (err) {
    if (err instanceof BridgeValidationError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  // Bind the payout to the user's VERIFIED TON address. A Telegram-only session
  // (no ton_proof) is NOT sufficient to choose a TON destination, and the
  // destination must match the verified address — never an arbitrary one.
  const norm = (a: string) => a.trim().toLowerCase();
  if (!session.tonAddress || norm(session.tonAddress) !== norm(parsed.toTon)) {
    return Response.json(
      { error: 'Withdraw destination must match your verified TON wallet — reconnect TON and try again.' },
      { status: 403 },
    );
  }

  const params = buildSymbiosisWithdrawParams(parsed);

  try {
    const quote: BridgeQuoteResponse = await symbiosis.quote(params);
    // Surface the resolved ERC-20 spender in server logs. The bridge metaRoute
    // pulls USDC via transferFrom, and the client approves `approveTo ?? to`. If
    // Symbiosis ever omits `approveTo`, the fallback to `to` (the router, not its
    // gateway) is the WRONG spender and transferFrom still fails — this log lets
    // us confirm `approveTo` is present on live quotes.
    const evmTx = quote.evmTransaction;
    console.info('[bridge/withdraw-quote] resolved EVM bridge tx', {
      to: evmTx?.to ?? null,
      approveTo: evmTx?.approveTo ?? null,
      hasApproveTo: evmTx?.approveTo != null,
      resolvedSpender: evmTx?.approveTo ?? evmTx?.to ?? null,
      chainId: evmTx?.chainId ?? null,
    });
    return Response.json(quote);
  } catch (err) {
    if (err instanceof BridgeError) {
      return Response.json({ error: 'Bridge quote failed.', detail: err.message }, { status: 502 });
    }
    return Response.json({ error: 'Unexpected error building withdraw quote.' }, { status: 500 });
  }
}

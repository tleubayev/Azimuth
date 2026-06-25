import { sendTransactionServer, assertWalletOwnership, OwnershipError } from '@/lib/server/privy';
import { getSession } from '@/lib/server/session';
import { clientIp, rateLimit, tooManyRequests } from '@/lib/server/rateLimit';

/**
 * POST /api/privy/send-transaction
 *
 * Server-side EVM transaction signing + broadcast with the user's delegated
 * embedded wallet — so the user is never prompted. Same defense in depth as
 * /api/privy/sign-typed-data: verified session + access-token wallet ownership
 * + auth-key delegation.
 */
export const runtime = 'nodejs';

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const HEX = /^0x[0-9a-fA-F]*$/; // calldata
const QUANTITY = /^(0x[0-9a-fA-F]+|[0-9]+)$/; // wei value / gas (hex or decimal)

export async function POST(req: Request): Promise<Response> {
  const limit = rateLimit(`privy-tx:${clientIp(req)}`, 60, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfterSeconds);

  const session = await getSession();
  if (!session || (!session.tonAddress && session.telegramUserId == null)) {
    return Response.json({ error: 'Unauthorized — verify your wallet first.' }, { status: 401 });
  }

  let body: { address?: string; to?: string; data?: string; value?: string; gas?: string; chainId?: number; accessToken?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const { address, to, data, value, gas, chainId, accessToken } = body;
  if (typeof address !== 'string' || !ADDR.test(address)) {
    return Response.json({ error: 'address must be a 0x-prefixed EVM address.' }, { status: 400 });
  }
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    return Response.json({ error: 'accessToken is required.' }, { status: 400 });
  }
  if (typeof to !== 'string' || !ADDR.test(to)) {
    return Response.json({ error: 'to must be a 0x-prefixed EVM address.' }, { status: 400 });
  }
  if (typeof chainId !== 'number' || !Number.isInteger(chainId) || chainId <= 0) {
    return Response.json({ error: 'chainId must be a positive integer.' }, { status: 400 });
  }
  if (data !== undefined && (typeof data !== 'string' || !HEX.test(data))) {
    return Response.json({ error: 'data must be a 0x-prefixed hex string.' }, { status: 400 });
  }
  if (value !== undefined && (typeof value !== 'string' || !QUANTITY.test(value))) {
    return Response.json({ error: 'value must be a hex or decimal quantity string.' }, { status: 400 });
  }
  if (gas !== undefined && (typeof gas !== 'string' || !QUANTITY.test(gas))) {
    return Response.json({ error: 'gas must be a hex or decimal quantity string.' }, { status: 400 });
  }

  try {
    await assertWalletOwnership(accessToken, address);
    const hash = await sendTransactionServer(address, { to, data, value, gas, chainId });
    return Response.json({ hash });
  } catch (err) {
    if (err instanceof OwnershipError) {
      return Response.json({ error: 'Not authorized to transact from this wallet.' }, { status: 403 });
    }
    // Log the raw upstream detail server-side; never expose it to the client.
    console.error('[privy/send-transaction] transaction failed:', err);
    return Response.json({ error: 'Server transaction failed. Please try again.' }, { status: 502 });
  }
}

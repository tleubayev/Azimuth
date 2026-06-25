import { signTypedDataServer, assertWalletOwnership, OwnershipError } from '@/lib/server/privy';
import { getSession } from '@/lib/server/session';
import { clientIp, rateLimit, tooManyRequests } from '@/lib/server/rateLimit';
import type { TypedDataToSign } from '@compass-labs/widgets';

/**
 * POST /api/privy/sign-typed-data
 *
 * Server-side EIP-712 signing with the user's delegated embedded wallet — so the
 * user is never prompted. Defense in depth: (1) a verified app session
 * (ton_proof / Telegram initData), (2) ownership — the caller's Privy access
 * token must show the requested address is one of THEIR wallets (so a user can't
 * sign for someone else's delegated wallet), and (3) the auth-key delegation
 * itself (Privy only signs for wallets the key quorum was added to).
 */
export const runtime = 'nodejs';

const ADDR = /^0x[0-9a-fA-F]{40}$/;

export async function POST(req: Request): Promise<Response> {
  const limit = rateLimit(`privy-sign:${clientIp(req)}`, 60, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfterSeconds);

  const session = await getSession();
  if (!session || (!session.tonAddress && session.telegramUserId == null)) {
    return Response.json({ error: 'Unauthorized — verify your wallet first.' }, { status: 401 });
  }

  let body: { address?: string; typedData?: TypedDataToSign; accessToken?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const address = body.address;
  if (typeof address !== 'string' || !ADDR.test(address)) {
    return Response.json({ error: 'address must be a 0x-prefixed EVM address.' }, { status: 400 });
  }
  if (typeof body.accessToken !== 'string' || body.accessToken.length === 0) {
    return Response.json({ error: 'accessToken is required.' }, { status: 400 });
  }
  if (!body.typedData || typeof body.typedData !== 'object') {
    return Response.json({ error: 'typedData is required.' }, { status: 400 });
  }

  try {
    await assertWalletOwnership(body.accessToken, address);
    const signature = await signTypedDataServer(address, body.typedData);
    return Response.json({ signature });
  } catch (err) {
    if (err instanceof OwnershipError) {
      return Response.json({ error: 'Not authorized to sign for this wallet.' }, { status: 403 });
    }
    // Log the raw upstream detail server-side; never expose it to the client.
    console.error('[privy/sign-typed-data] signing failed:', err);
    return Response.json({ error: 'Server signing failed. Please try again.' }, { status: 502 });
  }
}

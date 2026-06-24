import { TransactionReceiptNotFoundError } from 'viem';
import { isSupportedEvmChain, publicClientForChain } from '@/lib/server/evm';
import { getSession } from '@/lib/server/session';
import { clientIp, rateLimit, tooManyRequests } from '@/lib/server/rateLimit';

/**
 * POST /api/evm/receipt
 *
 * A single, NON-blocking check of whether an EVM tx has been mined, via a
 * server-side RPC (so RPC URLs stay server-side). The client POLLS this between
 * the withdraw bridge's two legs:
 *
 *   Privy returns a hash once a tx is BROADCAST, not mined. The bridge tx is then
 *   gas-estimated server-side against the latest MINED block — so if we send it
 *   before the approve has landed, the estimate sees zero allowance and Privy
 *   rejects it with "TransferHelper::transferFrom failed". Confirming the approve
 *   is mined here (allowance live) before bridging closes that race.
 *
 * Kept stateless + fast (one RPC call) so it never holds a serverless function
 * open while waiting; the deadline/poll loop lives client-side (useWithdraw).
 */
export const runtime = 'nodejs';

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

export async function POST(req: Request): Promise<Response> {
  const limit = rateLimit(`evm-receipt:${clientIp(req)}`, 120, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfterSeconds);

  const session = await getSession();
  if (!session || (!session.tonAddress && session.telegramUserId == null)) {
    return Response.json({ error: 'Unauthorized — verify your wallet first.' }, { status: 401 });
  }

  let body: { chainId?: number; hash?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const { chainId, hash } = body;
  if (typeof chainId !== 'number' || !Number.isInteger(chainId) || !isSupportedEvmChain(chainId)) {
    return Response.json({ error: 'chainId must be a supported EVM chain id.' }, { status: 400 });
  }
  if (typeof hash !== 'string' || !TX_HASH.test(hash)) {
    return Response.json({ error: 'hash must be a 0x-prefixed 32-byte tx hash.' }, { status: 400 });
  }

  try {
    const client = publicClientForChain(chainId);
    const receipt = await client.getTransactionReceipt({ hash: hash as `0x${string}` });
    // receipt.status is 'success' | 'reverted'.
    return Response.json({ mined: true, status: receipt.status });
  } catch (err) {
    // Not mined yet (tx still pending / unknown) → viem throws this. Report as
    // pending so the client keeps polling rather than failing the withdraw.
    if (err instanceof TransactionReceiptNotFoundError) {
      return Response.json({ mined: false });
    }
    console.error('[evm/receipt] receipt lookup failed:', err);
    return Response.json({ error: 'Receipt lookup failed.' }, { status: 502 });
  }
}

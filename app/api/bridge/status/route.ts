import { BridgeError, symbiosis } from '@/lib/bridge/symbiosis';
import type { BridgeStatusResponse } from '@/lib/bridge/types';

/**
 * GET /api/bridge/status?chainId=<id>&txHash=<hash>
 *
 * Polls the settlement state of a previously-signed source transaction via the
 * Symbiosis `/v2/tx/{chainId}/{txHash}` endpoint and returns a normalized
 * {@link BridgeStatusResponse}.
 */
export const runtime = 'nodejs';

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const chainId = url.searchParams.get('chainId');
  const txHash = url.searchParams.get('txHash');

  if (!chainId || chainId.trim() === '') {
    return Response.json({ error: 'chainId query param is required.' }, { status: 400 });
  }
  if (!txHash || txHash.trim() === '') {
    return Response.json({ error: 'txHash query param is required.' }, { status: 400 });
  }

  try {
    const status: BridgeStatusResponse = await symbiosis.getTxStatus({ chainId, txHash });
    return Response.json(status);
  } catch (err) {
    if (err instanceof BridgeError) {
      return Response.json(
        { error: 'Bridge status lookup failed.', detail: err.message },
        { status: 502 },
      );
    }
    return Response.json({ error: 'Unexpected error fetching bridge status.' }, { status: 500 });
  }
}

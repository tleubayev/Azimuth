import { forwardCompassPrepare } from '@/lib/server/compassForward';
import { withSpotFee } from '@/lib/tokenized/fee';
import { SPOT_FEE_RECIPIENT, SPOT_FEE_PERCENT, SPOT_FEE_ENABLED } from '@/lib/config/tokenized';

/**
 * POST /api/compass/tokenized-assets/order/[hash]/charge_fee
 *
 * Charges the partner fee on a FILLED Ondo-equity sell. Equity orders fill
 * off-chain via a 1inch resolver, so (unlike Midas) the fee can't ride inside
 * the trade — after the sell fills, the API reads the realized USDC proceeds and
 * builds a USDC transfer to our recipient, which the client signs + executes.
 *
 * A custom route is required because the shared proxy routes ANY `tokenized-
 * assets/order/...` path to order-status, and to keep the recipient server-
 * authoritative (injected from NEXT_PUBLIC_TOKENIZED_FEE_ADDRESS). 400s when the
 * fee isn't configured — the client gates on the enabled flag, so this is just
 * defense in depth.
 */
export const runtime = 'nodejs';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ hash: string }> },
): Promise<Response> {
  if (!SPOT_FEE_ENABLED) {
    return Response.json({ error: 'Spot fee is not configured.' }, { status: 400 });
  }
  const { hash } = await params;
  return forwardCompassPrepare(req, {
    name: 'tokenized-charge-fee',
    apiPath: `v2/tokenized_assets/order/${encodeURIComponent(hash)}/charge_fee`,
    transformBody: (body) => withSpotFee(body, { recipient: SPOT_FEE_RECIPIENT, percent: SPOT_FEE_PERCENT }),
  });
}

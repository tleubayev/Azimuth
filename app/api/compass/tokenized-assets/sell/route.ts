import { forwardCompassPrepare } from '@/lib/server/compassForward';
import { withSpotFee } from '@/lib/tokenized/fee';
import { SPOT_FEE_RECIPIENT, SPOT_FEE_PERCENT } from '@/lib/config/tokenized';

/**
 * POST /api/compass/tokenized-assets/sell
 *
 * Custom sell route that shadows the shared `/api/compass/[...path]` proxy,
 * whose tokenized-trade wrapper RECONSTRUCTS the body field-by-field and drops
 * any `fee` (the same reason perps market-order needs a custom route).
 * Forwarding to the raw REST API lets us attach the partner fee on the SELL leg.
 *
 * The fee `{ recipient, amount, denomination }` is injected SERVER-SIDE from
 * NEXT_PUBLIC_TOKENIZED_FEE_ADDRESS and taken from the USDC proceeds inside the
 * SAME execution (one signature → seamless for the user). Any client-supplied
 * `fee` is stripped. With no recipient configured the sell forwards fee-free,
 * identical to the proxy. Buys keep using the shared proxy — the API rejects a
 * fee on buy (exit-only).
 */
export const runtime = 'nodejs';

export const POST = (req: Request): Promise<Response> =>
  forwardCompassPrepare(req, {
    name: 'tokenized-sell',
    apiPath: 'v2/tokenized_assets/transact/sell',
    transformBody: (body) => withSpotFee(body, { recipient: SPOT_FEE_RECIPIENT, percent: SPOT_FEE_PERCENT }),
  });

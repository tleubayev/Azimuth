import { forwardPerpsPrepare } from '@/lib/server/compassForward';
import { withCloseBuilderFee } from '@/lib/perps/builderFee';
import { BUILDER_ADDRESS, BUILDER_FEE_RATE } from '@/lib/config/perps';

/**
 * POST /api/compass/global-markets-perps/market-order
 *
 * Prepares a Hyperliquid market order. This static route shadows the shared
 * `/api/compass/[...path]` proxy because the published proxy's market-order
 * wrapper DROPS the `builder` field — so it can never carry a builder fee.
 * Forwarding to the raw REST API directly lets us attach one.
 *
 * The builder fee is injected SERVER-SIDE and only on CLOSES (`reduce_only`),
 * from `NEXT_PUBLIC_PERPS_BUILDER_ADDRESS`. Any client-supplied `builder` is
 * stripped and replaced with ours, so the fee can't be stripped or redirected
 * by tampering with the request. Opens (and any env without a builder address)
 * forward fee-free.
 */
export const runtime = 'nodejs';

export const POST = (req: Request): Promise<Response> =>
  forwardPerpsPrepare(req, {
    name: 'market-order',
    apiPath: 'v2/global_markets_perps/market_order',
    transformBody: (body) => withCloseBuilderFee(body, { address: BUILDER_ADDRESS, rate: BUILDER_FEE_RATE }),
  });

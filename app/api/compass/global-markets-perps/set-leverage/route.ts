import { forwardPerpsPrepare } from '@/lib/server/compassForward';

/**
 * POST /api/compass/global-markets-perps/set-leverage
 *
 * Prepares a Hyperliquid `updateLeverage` action for a global-markets-perps
 * asset. `leverage` is an optional whole-number multiplier (1..market max);
 * omit it to use the asset's maximum. Like every other perps prepare endpoint,
 * the response is an UNSIGNED `{ typed_data, action, nonce }` (or
 * `leverage_ok: true` when already at the target) — nothing executes here.
 *
 * Why this route exists instead of the shared `/api/compass/[...path]` proxy:
 * that proxy's route table lives in the published `@compass-labs/widgets`
 * package (`createCompassHandler`) and has no `set-leverage` case yet. A static
 * route wins over the `[...path]` catch-all, so this self-contained app forwards
 * the call directly. See `forwardPerpsPrepare` for the shared mechanics.
 */
export const runtime = 'nodejs';

export const POST = (req: Request): Promise<Response> =>
  forwardPerpsPrepare(req, {
    name: 'set-leverage',
    apiPath: 'v2/global_markets_perps/set_leverage',
  });

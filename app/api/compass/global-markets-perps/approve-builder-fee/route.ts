import { forwardPerpsPrepare } from '@/lib/server/compassForward';
import { withApprovalBuilder } from '@/lib/perps/builderFee';
import { BUILDER_ADDRESS, BUILDER_FEE_RATE, BUILDER_FEE_ENABLED } from '@/lib/config/perps';

/**
 * POST /api/compass/global-markets-perps/approve-builder-fee
 *
 * Prepares the one-time Hyperliquid `approveBuilderFee` action authorizing our
 * builder to charge up to `BUILDER_FEE_RATE`. Returns an UNSIGNED
 * `{ typed_data, action, nonce }`; the client signs + submits via `/execute`.
 *
 * The builder `{ address, max_fee_rate }` is injected SERVER-SIDE from
 * `NEXT_PUBLIC_PERPS_BUILDER_ADDRESS`; the client only sends `{ owner }`. A
 * static route is needed because this never goes through the shared proxy here
 * (and to keep the builder config server-authoritative). 400s if the builder
 * isn't configured — callers gate on `BUILDER_FEE_ENABLED`, so this shouldn't
 * happen, but it fails loudly rather than preparing a builder-less approval.
 */
export const runtime = 'nodejs';

export function POST(req: Request): Promise<Response> {
  if (!BUILDER_FEE_ENABLED) {
    return Promise.resolve(
      Response.json({ error: 'Builder fee is not configured.' }, { status: 400 }),
    );
  }
  return forwardPerpsPrepare(req, {
    name: 'approve-builder-fee',
    apiPath: 'v2/global_markets_perps/approve_builder_fee',
    transformBody: (body) => withApprovalBuilder(body, { address: BUILDER_ADDRESS, rate: BUILDER_FEE_RATE }),
  });
}

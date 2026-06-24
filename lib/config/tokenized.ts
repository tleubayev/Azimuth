/**
 * Spot (tokenized-assets) partner-fee config. Mirrors lib/config/perps.ts.
 *
 * A fee is charged ONLY on SELL/exit, taken from the USDC proceeds and sent to
 * SPOT_FEE_RECIPIENT — atomically for Midas RWA swaps, and via a post-fill
 * charge for Ondo equities. The recipient is injected SERVER-SIDE by the custom
 * sell / charge-fee routes (so it can't be stripped client-side); the public
 * flag here only lets the client decide whether to run the equity post-fill
 * charge step. Leave the address UNSET to disable the fee (spot trades fee-free).
 */

/** Fee recipient, or null when the spot fee is disabled. Public (appears on-chain). */
export const SPOT_FEE_RECIPIENT =
  process.env.NEXT_PUBLIC_TOKENIZED_FEE_ADDRESS?.trim() || null;

/** Percentage of the USDC sell proceeds taken as the fee, e.g. "1" → 1%. */
export const SPOT_FEE_PERCENT =
  process.env.NEXT_PUBLIC_TOKENIZED_FEE_PERCENT?.trim() || '1';

/** Whether the spot partner fee is configured. */
export const SPOT_FEE_ENABLED = SPOT_FEE_RECIPIENT !== null;

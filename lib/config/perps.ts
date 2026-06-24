/**
 * Builder-fee config for Global Markets Perps (Hyperliquid).
 *
 * We charge a Hyperliquid "builder fee" on CLOSES only. The fee accrues to
 * `BUILDER_ADDRESS` — a Hyperliquid account we control that must hold ≥100 USDC
 * on perps (Hyperliquid's eligibility rule) or both approval and fee'd closes
 * are rejected by the exchange. The address is public (it appears on-chain in
 * every fee'd order), so `NEXT_PUBLIC_` is fine; the SAME value is read
 * server-side by the `market-order` / `approve-builder-fee` routes, which are
 * the authoritative injectors — they strip any client-supplied `builder` and
 * replace it with ours, so the fee can't be stripped or redirected by tampering.
 *
 * Unset address ⇒ the whole feature no-ops: perps trade fee-free. This is the
 * safe default for local/dev and any environment where the builder account
 * isn't funded yet.
 */

/** Charged builder fee, in Hyperliquid grammar. 0.1% is the perps cap. */
export const BUILDER_FEE_RATE = '0.1%';

/** Hyperliquid account that collects the builder fee, or null when disabled. */
export const BUILDER_ADDRESS: string | null =
  process.env.NEXT_PUBLIC_PERPS_BUILDER_ADDRESS?.trim() || null;

/** True when a builder address is configured — gates approval + UI disclosure. */
export const BUILDER_FEE_ENABLED = BUILDER_ADDRESS !== null;

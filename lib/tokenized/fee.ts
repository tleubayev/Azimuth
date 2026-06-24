/**
 * Pure spot partner-fee logic, shared by the custom sell + charge-fee routes
 * (server-side injection). Kept free of env/IO so it's unit-testable.
 *
 * The app charges a partner fee on SELL/exit only, taken from the USDC proceeds
 * (mirroring earn/credit and the perps builder fee). Buys are never fee'd — the
 * API rejects a fee on buy — so the sell route is the sole injector. The server
 * is authoritative: any client-supplied `fee` is stripped and replaced with ours.
 */

export interface SpotFeeConfig {
  /** Fee recipient, or null when the fee is disabled. */
  recipient: string | null;
  /** Percentage of the USDC proceeds, e.g. "1" for 1%. */
  percent: string;
}

/** Partner-fee object in the tokenized-assets API shape (PERCENTAGE of proceeds). */
export interface SpotFee {
  recipient: string;
  amount: string;
  denomination: 'PERCENTAGE';
}

type Body = Record<string, unknown>;

/** The `fee` object to attach, or null when no recipient / a non-positive rate. */
export function spotFeeField(cfg: SpotFeeConfig): SpotFee | null {
  if (!cfg.recipient) return null;
  const pct = Number(cfg.percent);
  if (!Number.isFinite(pct) || pct <= 0) return null;
  return { recipient: cfg.recipient, amount: cfg.percent, denomination: 'PERCENTAGE' };
}

/**
 * Inject the server-controlled partner fee into a sell / charge-fee body. Any
 * client-supplied `fee` is stripped first, so the recipient + rate can't be
 * substituted or removed by tampering with the request. Returns the body
 * unchanged (fee-free) when no recipient is configured.
 */
export function withSpotFee(body: Body, cfg: SpotFeeConfig): Body {
  const rest = { ...body };
  delete rest.fee;
  const fee = spotFeeField(cfg);
  return fee ? { ...rest, fee } : rest;
}

/**
 * Pure builder-fee logic, shared by the server routes (injection) and the
 * trade hook (self-heal). Kept free of env/IO so it's unit-testable.
 *
 * Hyperliquid charges a "builder fee" when an order carries a `builder`
 * `{ address, max_fee_rate }`. We attach it on CLOSES only (reduce-only market
 * orders), so opening/adding is free and only realizing a position pays. The
 * server route is the sole injector — the client never sends `builder`.
 */

export interface BuilderConfig {
  /** Funded Hyperliquid builder account, or null when the fee is disabled. */
  address: string | null;
  /** Fee rate in Hyperliquid grammar, e.g. "0.1%". */
  rate: string;
}

type Body = Record<string, unknown>;

/** The `builder` object to attach, or null when no address is configured. */
export function builderField(cfg: BuilderConfig): { address: string; max_fee_rate: string } | null {
  return cfg.address ? { address: cfg.address, max_fee_rate: cfg.rate } : null;
}

/** Drop any client-supplied `builder` so the server alone controls the field. */
function stripBuilder(body: Body): Body {
  if (!('builder' in body)) return body;
  const rest = { ...body };
  delete rest.builder;
  return rest;
}

/**
 * Set the builder fee on a market order — CLOSES only. A close is a reduce-only
 * order (`reduce_only === true`); opens never set it, so they stay fee-free.
 *
 * The server is authoritative: any client-supplied `builder` is STRIPPED first,
 * then ours is attached on an enabled close. So a caller hitting the public
 * route directly can neither strip the fee nor substitute their own builder by
 * putting one in the request body.
 */
export function withCloseBuilderFee(body: Body, cfg: BuilderConfig): Body {
  const base = stripBuilder(body);
  if (base.reduce_only !== true) return base; // opens / non-closes stay fee-free
  const builder = builderField(cfg);
  return builder ? { ...base, builder } : base;
}

/**
 * Set the builder on an `approve_builder_fee` request. Strips any client-supplied
 * `builder` and attaches ours from config (the route only forwards when the fee
 * is enabled), so the authorized builder + rate are always server-controlled.
 */
export function withApprovalBuilder(body: Body, cfg: BuilderConfig): Body {
  const base = stripBuilder(body);
  const builder = builderField(cfg);
  return builder ? { ...base, builder } : base;
}

/**
 * Whether a thrown error looks like a missing/stale builder-fee approval —
 * Hyperliquid rejects a fee'd order whose builder the user hasn't authorized
 * up to the order's rate. Used to decide whether to re-approve and retry once.
 */
export function isBuilderApprovalError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return /builder\s*fee|approve\s*builder|builder.*approv|max\s*builder\s*fee/i.test(msg);
}

/**
 * Pure helpers that turn a validated {@link BridgeQuoteRequest} into the
 * Symbiosis quote params, and validate untrusted request bodies. Kept free of
 * I/O so the route logic is unit-testable without a running server.
 */

import { FUNDING_TARGETS, CHAIN_IDS, USDC_DECIMALS, TON_USDT } from '@/lib/config/chains';
import type { FundingTargetKey } from '@/lib/config/chains';
import { DEFAULT_SLIPPAGE_BPS } from './symbiosis';
import type { SymbiosisQuoteParams } from './symbiosis';
import type { BridgeQuoteRequest } from './types';

/** The chain id Symbiosis uses for TON. */
export const TON_CHAIN_ID = CHAIN_IDS.ton;

/**
 * Convert a human decimal amount (e.g. "12.5") to the token's base units as a
 * string (e.g. "12500000" for 6 decimals). Symbiosis `/v2/quote` expects base
 * units, not human decimals. Done with string math to avoid float rounding.
 */
export function toBaseUnits(amount: string, decimals: number): string {
  const [intPart, fracPart = ''] = amount.split('.');
  const frac = (fracPart + '0'.repeat(decimals)).slice(0, decimals);
  const combined = `${intPart}${frac}`.replace(/^0+/, '');
  return combined === '' ? '0' : combined;
}

/** A request that failed validation; carries the field that was wrong. */
export class BridgeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BridgeValidationError';
  }
}

function isFundingTargetKey(value: unknown): value is FundingTargetKey {
  return typeof value === 'string' && value in FUNDING_TARGETS;
}

/**
 * Validate and normalize an untrusted POST body into a {@link BridgeQuoteRequest}.
 * Throws {@link BridgeValidationError} (→ HTTP 400) on any problem.
 */
export function parseQuoteRequest(raw: unknown): BridgeQuoteRequest {
  if (!raw || typeof raw !== 'object') {
    throw new BridgeValidationError('Request body must be a JSON object.');
  }
  const body = raw as Record<string, unknown>;

  if (!isFundingTargetKey(body.targetKey)) {
    throw new BridgeValidationError(
      `targetKey must be one of: ${Object.keys(FUNDING_TARGETS).join(', ')}.`,
    );
  }

  const amount = body.amount;
  if (typeof amount !== 'string' || !isPositiveDecimal(amount)) {
    throw new BridgeValidationError('amount must be a positive decimal string.');
  }

  const fromTon = body.fromTon;
  if (typeof fromTon !== 'string' || fromTon.trim() === '') {
    throw new BridgeValidationError('fromTon (TON address) is required.');
  }

  const toEvm = body.toEvm;
  if (typeof toEvm !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(toEvm)) {
    throw new BridgeValidationError('toEvm must be a 0x-prefixed EVM address.');
  }

  let slippageBps: number | undefined;
  if (body.slippageBps !== undefined) {
    const n = body.slippageBps;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 5000) {
      throw new BridgeValidationError('slippageBps must be an integer between 0 and 5000.');
    }
    slippageBps = n;
  }

  let tokenInTon: string | undefined;
  if (body.tokenInTon !== undefined) {
    if (typeof body.tokenInTon !== 'string' || body.tokenInTon.trim() === '') {
      throw new BridgeValidationError('tokenInTon must be a non-empty string when provided.');
    }
    tokenInTon = body.tokenInTon;
  }

  return {
    targetKey: body.targetKey,
    amount,
    fromTon,
    toEvm,
    ...(slippageBps !== undefined ? { slippageBps } : {}),
    ...(tokenInTon !== undefined ? { tokenInTon } : {}),
  };
}

/**
 * Build the Symbiosis `/v2/quote` params from a validated bridge request by
 * resolving the destination chain + USDC token from {@link FUNDING_TARGETS}.
 *
 * - `tokenOut` is the funding target's USDC (perps → Arbitrum, tokenized → Ethereum).
 * - `from` is the TON address (also used as `revertableAddress` inside the client).
 * - `to` is the Privy EVM address.
 */
export function buildSymbiosisQuoteParams(req: BridgeQuoteRequest): SymbiosisQuoteParams {
  const target = FUNDING_TARGETS[req.targetKey];
  return {
    tokenAmountIn: {
      // Symbiosis wants base units; the user types a human amount (≈ USD).
      amount: toBaseUnits(req.amount, TON_USDT.decimals),
      address: TON_USDT.address,
      chainId: TON_CHAIN_ID,
      decimals: TON_USDT.decimals,
      attributes: { ton: TON_USDT.tonAddress },
    },
    tokenOut: {
      address: target.token,
      chainId: target.chainId,
      decimals: USDC_DECIMALS,
    },
    from: req.fromTon,
    to: req.toEvm,
    slippageBps: req.slippageBps ?? DEFAULT_SLIPPAGE_BPS,
  };
}

function isPositiveDecimal(value: string): boolean {
  if (!/^\d+(\.\d+)?$/.test(value)) return false;
  return Number(value) > 0;
}

/* ─────────────────────── Withdraw (EVM → TON) leg ─────────────────────────── */

/** Validated body for POST /api/bridge/withdraw-quote. */
export interface BridgeWithdrawQuoteRequest {
  /** Funding preset → which EVM chain the USDC is leaving from. */
  targetKey: FundingTargetKey;
  /** Human USDC amount on the EVM side (decimal string). */
  amount: string;
  /** Source: the user's embedded EVM address (also the refund address). */
  fromEvm: string;
  /** Destination: the user's TON address. */
  toTon: string;
  slippageBps?: number;
}

/**
 * Validate an untrusted POST body for the withdraw (EVM→TON) quote.
 * Throws {@link BridgeValidationError} (→ HTTP 400) on any problem.
 */
export function parseWithdrawQuoteRequest(raw: unknown): BridgeWithdrawQuoteRequest {
  if (!raw || typeof raw !== 'object') {
    throw new BridgeValidationError('Request body must be a JSON object.');
  }
  const body = raw as Record<string, unknown>;

  if (!isFundingTargetKey(body.targetKey)) {
    throw new BridgeValidationError(`targetKey must be one of: ${Object.keys(FUNDING_TARGETS).join(', ')}.`);
  }
  const amount = body.amount;
  if (typeof amount !== 'string' || !isPositiveDecimal(amount)) {
    throw new BridgeValidationError('amount must be a positive decimal string.');
  }
  const fromEvm = body.fromEvm;
  if (typeof fromEvm !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(fromEvm)) {
    throw new BridgeValidationError('fromEvm must be a 0x-prefixed EVM address.');
  }
  const toTon = body.toTon;
  if (typeof toTon !== 'string' || toTon.trim() === '') {
    throw new BridgeValidationError('toTon (TON address) is required.');
  }
  let slippageBps: number | undefined;
  if (body.slippageBps !== undefined) {
    const n = body.slippageBps;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 5000) {
      throw new BridgeValidationError('slippageBps must be an integer between 0 and 5000.');
    }
    slippageBps = n;
  }

  return {
    targetKey: body.targetKey,
    amount,
    fromEvm,
    toTon,
    ...(slippageBps !== undefined ? { slippageBps } : {}),
  };
}

/**
 * Build Symbiosis `/v2/quote` params for the REVERSE leg: USDC on the funding
 * target's EVM chain → USD₮ on TON. `from` is the embedded EVM address (and the
 * refund target); `to` is the user's TON address. Returns an EVM-side tx
 * (`evmTransaction`) for the embedded wallet to send.
 */
export function buildSymbiosisWithdrawParams(req: BridgeWithdrawQuoteRequest): SymbiosisQuoteParams {
  const target = FUNDING_TARGETS[req.targetKey];
  return {
    tokenAmountIn: {
      amount: toBaseUnits(req.amount, USDC_DECIMALS),
      address: target.token,
      chainId: target.chainId,
      decimals: USDC_DECIMALS,
    },
    tokenOut: {
      address: TON_USDT.address,
      chainId: TON_CHAIN_ID,
      decimals: TON_USDT.decimals,
    },
    from: req.fromEvm,
    to: req.toTon,
    slippageBps: req.slippageBps ?? DEFAULT_SLIPPAGE_BPS,
  };
}

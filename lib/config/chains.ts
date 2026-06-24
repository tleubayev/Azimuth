/**
 * Shared chain / token configuration.
 *
 * The two Compass widgets reused by this app trade on EVM, and need funds on
 * specific chains (see docs/plans/2026-06-15-telegram-ton-miniapp):
 *   - Hyperliquid perps  → USDC on Arbitrum (42161)
 *   - Tokenized assets    → USDC on Ethereum (1)   [+ Base (8453) for RWA]
 *
 * The Symbiosis bridge delivers these to the user's Privy embedded EVM address.
 */

export const CHAIN_IDS = {
  ethereum: 1,
  arbitrum: 42161,
  base: 8453,
  // Symbiosis' numeric chain id for TON (from GET /v1/chains). MUST be the number,
  // not the string "ton" — the quote API rejects a non-numeric chainId.
  ton: 85918,
} as const;

/**
 * Source token bridged FROM TON: USD₮ (the jetton Symbiosis supports for TON
 * cross-chain). Symbiosis identifies it by an EVM-mapped `address` plus the real
 * jetton master in `attributes.ton` — both are required by /v2/quote (omitting
 * the latter yields "undefined has no ton address"). Values from
 * GET /v1/tokens (chainId 85918).
 */
export const TON_USDT = {
  symbol: 'USDT',
  /** Symbiosis EVM-mapped address for USD₮ on TON. */
  address: '0x9328Eb759596C38a25f59028B146Fecdc3621Dfe',
  /** Jetton master on TON — sent as `attributes.ton`. */
  tonAddress: 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs',
  decimals: 6,
} as const;

/** Native USDC token addresses on each EVM target chain. */
export const USDC = {
  ethereum: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  arbitrum: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
} as const;

/** USDC decimals (same on every chain). */
export const USDC_DECIMALS = 6;

/** Hyperliquid Bridge2 on Arbitrum — perps deposits transfer USDC here. */
export const HL_BRIDGE = '0x2Df1c51E09aECF9cacB7bc98cB1742757f163dF7';

/**
 * EVM source chains the WITHDRAW-to-TON flow supports: tokenized leaves from
 * Ethereum, perps from Arbitrum — both bridge back to TON via Symbiosis. Single
 * source of truth for the client gate (lib/hooks/useWithdraw.ts) and the
 * server-side receipt client (lib/server/evm.ts); keep those in sync with this.
 */
export const WITHDRAW_TO_TON_CHAIN_IDS: readonly number[] = [
  CHAIN_IDS.ethereum,
  CHAIN_IDS.arbitrum,
];

export type FundingTargetKey = 'perps' | 'tokenized' | 'tokenized-base';

/** Which Compass product the funds ultimately flow into. */
export type FundingProduct = 'perps' | 'tokenized';

export interface FundingTarget {
  key: FundingTargetKey;
  label: string;
  /** Compass product the deposit funds (drives which deposit flow runs). */
  product: FundingProduct;
  /** EVM chain the funds must land on. */
  chainId: number;
  chainName: 'ethereum' | 'arbitrum' | 'base';
  /** Token the widget spends (always USDC here). */
  token: string;
  tokenSymbol: 'USDC';
  /** Minimum USDC that must reach the product account to deposit it, in USD. */
  minUsd: number;
  /** Minimum a user may bridge in one transfer, in USD. Omit for no bridge floor. */
  bridgeMinUsd?: number;
  description: string;
}

/** Funding presets shown in the "Add funds" UI (tokenized is Ethereum-only for now). */
export const FUNDING_OPTION_KEYS: FundingTargetKey[] = ['perps', 'tokenized'];

/**
 * Funding presets surfaced in the "Add funds" flow. The destination is always
 * the user's Privy embedded EVM address — never asked for.
 */
export const FUNDING_TARGETS: Record<FundingTargetKey, FundingTarget> = {
  perps: {
    key: 'perps',
    label: 'Perps',
    product: 'perps',
    chainId: CHAIN_IDS.arbitrum,
    chainName: 'arbitrum',
    token: USDC.arbitrum,
    tokenSymbol: 'USDC',
    minUsd: 10,
    bridgeMinUsd: 15,
    description: 'USDC on Arbitrum → Hyperliquid perps account ($15 minimum, no upper limit).',
  },
  tokenized: {
    key: 'tokenized',
    label: 'Stocks & RWA',
    product: 'tokenized',
    chainId: CHAIN_IDS.ethereum,
    chainName: 'ethereum',
    token: USDC.ethereum,
    tokenSymbol: 'USDC',
    minUsd: 25,
    description: 'USDC on Ethereum → tokenized equities & RWA account (≥$25 to trade).',
  },
  'tokenized-base': {
    key: 'tokenized-base',
    label: 'Stocks & RWA (Base)',
    product: 'tokenized',
    chainId: CHAIN_IDS.base,
    chainName: 'base',
    token: USDC.base,
    tokenSymbol: 'USDC',
    minUsd: 25,
    description: 'USDC on Base → tokenized RWA account.',
  },
};

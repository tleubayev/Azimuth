/**
 * Normalized data shapes for the Compass trading UI. The API returns mostly
 * snake_case; hooks normalize to the camelCase shapes here. EIP-712 payloads
 * reuse the widgets-sdk `TypedDataToSign` so they pass straight to the wallet
 * adapter's `signTypedData`.
 */

import type { TypedDataToSign } from '@compass-labs/widgets';

export type TypedData = TypedDataToSign;

/* ─────────────────────────────── Perps ───────────────────────────────────── */

export interface PerpsMarket {
  asset: string;
  assetId: number | null;
  category: string;
  markPrice: number;
  oraclePrice: number | null;
  openInterest: number | null;
  volume24h: number | null;
  fundingRate: number | null;
  maxLeverage: number;
  szDecimals: number;
}

export type PerpsSide = 'long' | 'short';

export interface PerpsPosition {
  asset: string;
  side: PerpsSide;
  size: string; // contract size (already human units)
  entryPrice: number | null;
  markPrice: number | null;
  liquidationPrice: number | null;
  unrealizedPnl: number;
  leverage: string;
  marginUsed: number | null;
  fundingAccrued: number | null;
}

export interface PerpsPositionsResult {
  positions: PerpsPosition[];
  withdrawable: number;
  accountValue: number;
}

export interface PerpsActivityItem {
  id: string;
  kind: 'fill' | 'order';
  side: 'buy' | 'sell';
  asset: string;
  price: string;
  size: string;
  timeMs: number;
  orderId: number;
  fee?: string;
  closedPnl?: string | null;
  reduceOnly?: boolean;
}

export interface Candle {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
}

export type CandleInterval = '15m' | '1h' | '4h' | '1d';

/**
 * Prepare payload shared by Hyperliquid action endpoints. The widgets proxy
 * camelCases the envelope (`typedData`); the raw-REST custom routes
 * (market-order, approve-builder-fee, set-leverage) return snake_case
 * (`typed_data`). `signAndExecutePerps` reads whichever is present.
 */
export interface PerpsPrepare {
  typedData?: TypedData | null;
  typed_data?: TypedData | null;
  action?: unknown;
  nonce?: number | string;
}

/* ───────────────────────────── Tokenized ─────────────────────────────────── */

export type TokenizedAssetClass = 'EQUITY' | 'T_BILLS' | 'BASIS_TRADE' | 'BTC_YIELD';
export type TokenizedProvider = 'ondo' | 'midas';

export interface TokenizedMarket {
  symbol: string;
  underlyingTicker: string;
  name: string;
  contractAddress: string;
  decimals: number;
  currentPriceUsd: number | null;
  change24hUsd: number | null;
  change24hPct: number | null;
  sectors: string[];
  provider: TokenizedProvider;
  assetClass: TokenizedAssetClass;
  chain: string;
  apy7d: number | null;
  tvlUsd: number | null;
}

export interface TokenizedPnl {
  totalDeposited: number;
  currentValue: number;
  unrealizedPnl: number;
  realizedPnl: number;
  totalPnl: number;
  totalPnlPercent: number;
}

export interface TokenizedPosition {
  symbol: string;
  underlyingTicker: string;
  name: string;
  balance: string; // human-readable token count
  currentPriceUsd: number | null;
  balanceUsd: number | null;
  assetClass: TokenizedAssetClass;
  pnl: TokenizedPnl | null;
}

export interface TokenizedPositionsResult {
  positions: TokenizedPosition[];
  totalUsd: number;
  accountPnl: TokenizedPnl | null;
  activity: TokenizedActivityItem[];
}

/**
 * One classified, token-moving event on a Spot position — the per-position
 * `events[]` from `/tokenized-assets/positions`, flattened into one chronological
 * feed (mirrors the perps activity feed). A `buy` pairs USDC `input` with token
 * `output`; a `sell` is the reverse and carries `realizedPnl`; transfers carry
 * only the token leg (the USDC side is `null`). All amounts are decimal strings.
 */
export type TokenizedEventType = 'buy' | 'sell' | 'transfer_in' | 'transfer_out';

export interface TokenizedActivityItem {
  id: string;
  eventType: TokenizedEventType;
  symbol: string; // on-chain symbol, e.g. TSLAon / mTBILL
  underlyingTicker: string; // display ticker, e.g. TSLA
  timeMs: number; // block time in ms (0 when unknown)
  txHash: string;
  inputAmount: string | null; // sent leg: USDC for a buy, tokens for a sell/transfer_out
  inputSymbol: string | null;
  outputAmount: string | null; // received leg: tokens for a buy/transfer_in, USDC for a sell
  outputSymbol: string | null;
  costPerUnit: string | null;
  realizedPnl: string | null; // realized P&L on a sell; null otherwise
}

export interface TokenizedAccount {
  accountAddress: string | null;
  isDeployed: boolean;
  needsCreation: boolean;
}

export interface TokenizedMarketDetail extends TokenizedMarket {
  candles: Candle[];
  priceHigh52w: number | null;
  priceLow52w: number | null;
  volume24h: number | null;
  marketCap: number | null;
}

export type TokenizedPeriod = '1D' | '1M' | '3M' | '6M' | '1Y' | 'ALL';

export const PERIOD_PARAMS: Record<TokenizedPeriod, { interval: string; range: string }> = {
  '1D': { interval: '15min', range: '1day' },
  '1M': { interval: '4hour', range: '1month' },
  '3M': { interval: '12hour', range: '3month' },
  '6M': { interval: '1day', range: '6month' },
  '1Y': { interval: '1day', range: '1year' },
  ALL: { interval: '1day', range: 'all' },
};

/** RWA yield tokens trade via swaps; equities use the Fusion order flow. */
export function isSwapTraded(assetClass: TokenizedAssetClass): boolean {
  return assetClass !== 'EQUITY';
}

export function assetClassLabel(assetClass: TokenizedAssetClass): string {
  switch (assetClass) {
    case 'EQUITY':
      return 'Stocks';
    case 'T_BILLS':
      return 'T-Bills';
    case 'BASIS_TRADE':
      return 'Basis';
    case 'BTC_YIELD':
      return 'BTC yield';
  }
}

/* Equity Fusion order flow payloads */
export interface EquityQuote {
  recommendedSlippageBps: number;
  amountOut: string | null;
  outSymbol: string | null;
  estFillSeconds: number | null;
}

export type OrderStatus = 'pending' | 'filled' | 'expired' | 'cancelled';

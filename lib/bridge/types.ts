/**
 * Stable, internal bridge types for the Symbiosis TON -> EVM funding flow.
 *
 * These shapes are what the route handlers and the frontend depend on. They are
 * deliberately decoupled from the raw Symbiosis REST response (whose exact field
 * names vary by version — see lib/bridge/symbiosis.ts for the mapping). Keeping a
 * stable internal shape means a Symbiosis API change only touches the mapper.
 */

import type { FundingTargetKey } from '@/lib/config/chains';

export type { FundingTargetKey };

/**
 * A single message in a TON Connect `sendTransaction` request. The user signs
 * exactly one of these (typically a jetton-transfer message) to authorize the
 * source leg of the bridge.
 *
 * Mirrors `@tonconnect/sdk`'s message shape so the payload can be handed
 * straight to `tonConnectUI.sendTransaction(...)`.
 */
export interface TonConnectMessage {
  /** Destination TON address (raw or user-friendly form). */
  address: string;
  /** nanoTON amount attached to the message, as a decimal string. */
  amount: string;
  /** Optional BoC payload (base64) — e.g. the jetton-transfer body. */
  payload?: string;
  /** Optional stateInit (base64) for messages that must deploy a contract. */
  stateInit?: string;
}

/**
 * TON Connect transaction request returned by a quote. Pass directly to
 * `tonConnectUI.sendTransaction(tonTransaction)`.
 */
export interface TonConnectTransaction {
  /** Unix seconds after which the wallet must reject the transaction. */
  validUntil: number;
  /** Optional TON chain marker ('-239' mainnet, '-3' testnet). */
  network?: string;
  /** Messages to sign (usually exactly one). */
  messages: TonConnectMessage[];
}

/**
 * EVM-side transaction returned by an EVM-origin quote (the WITHDRAW-to-TON leg).
 * Send it with the embedded wallet's `sendTransaction` to initiate EVM→TON.
 */
export interface EvmBridgeTransaction {
  /** Target contract (the Symbiosis router / metarouter). */
  to: string;
  /** Calldata (hex). */
  data?: string;
  /** Native value in wei (hex/decimal string), usually "0". */
  value?: string;
  /** EVM chain id the tx must be sent on (the source chain). */
  chainId?: number;
  /**
   * Spender that must be granted an ERC-20 allowance before the bridge tx — the
   * router pulls the source token via `transferFrom`, so without this the
   * metaRoute reverts ("TransferHelper::transferFrom failed"). Falls back to `to`.
   */
  approveTo?: string;
}

/** A token amount on a specific chain, surfaced to the UI. */
export interface BridgeTokenAmount {
  /** Decimal string in token units (e.g. "12.5"), not wei. */
  amount: string;
  /** Token contract address (EVM) or jetton master / native marker. */
  token: string;
  /** Chain id the amount lives on (numeric EVM id, or the Symbiosis TON id). */
  chainId: number | string;
  /** Token symbol when known. */
  symbol?: string;
  /** Token decimals when known. */
  decimals?: number;
}

/** Request accepted by POST /api/bridge/quote. */
export interface BridgeQuoteRequest {
  /** Which funding preset (perps -> Arbitrum USDC, tokenized -> Ethereum USDC). */
  targetKey: FundingTargetKey;
  /** Source amount in TON-side token units (decimal string, not nanoTON). */
  amount: string;
  /** User's TON address — source AND refund (revertableAddress). */
  fromTon: string;
  /** User's Privy embedded EVM address — the bridge destination. */
  toEvm: string;
  /** Slippage tolerance in basis points (defaults applied server-side). */
  slippageBps?: number;
  /**
   * Optional explicit source token on TON (jetton master address or native
   * marker). Defaults to the USD₮ jetton route when omitted.
   */
  tokenInTon?: string;
}

/** Normalized quote returned by POST /api/bridge/quote. */
export interface BridgeQuoteResponse {
  /** Estimated output delivered to the Privy EVM address. */
  amountOut: BridgeTokenAmount;
  /** Aggregate fee for the route (best-effort normalization). */
  fee: BridgeTokenAmount | null;
  /** Opaque Symbiosis route descriptor, passed through for display/debugging. */
  route: unknown;
  /**
   * The TON Connect message to sign. `null` only if Symbiosis returned no
   * source-leg transaction (should not happen for a TON-origin quote).
   */
  tonTransaction: TonConnectTransaction | null;
  /**
   * EVM-side source transaction, present for an EVM-origin (withdraw-to-TON)
   * quote. Mutually exclusive in practice with `tonTransaction`.
   */
  evmTransaction?: EvmBridgeTransaction | null;
  /** Estimated settlement time in seconds, when Symbiosis provides it. */
  estimatedTimeSeconds?: number;
}

/** Normalized status returned by GET /api/bridge/status. */
export interface BridgeStatusResponse {
  /** Internal lifecycle state mapped from the raw Symbiosis status. */
  status: BridgeStatus;
  /** Raw Symbiosis status string, preserved for diagnostics. */
  rawStatus?: string;
  /** Destination (EVM) transaction hash once the funds land, when available. */
  destinationTxHash?: string;
  /** The queried source tx hash, echoed back. */
  txHash: string;
  /** The queried source chain id, echoed back. */
  chainId: number | string;
}

/** Internal, stable lifecycle states for a cross-chain transfer. */
export type BridgeStatus = 'pending' | 'success' | 'failed' | 'reverted' | 'unknown';

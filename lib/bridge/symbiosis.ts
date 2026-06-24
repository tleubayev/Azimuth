/**
 * Server-side client for the Symbiosis crosschain REST API.
 *
 * We call the REST endpoints directly with global `fetch` (NOT the
 * `symbiosis-js-sdk`) so this stays a thin, dependency-free, server-only module
 * that can run inside a Next.js route handler on the Node runtime.
 *
 * Base URL: process.env.SYMBIOSIS_API_URL || 'https://api.symbiosis.finance/crosschain'
 *
 * Reference (research doc 05-ton-evm-bridging.md):
 *   GET  /v1/chains
 *   GET  /v1/swap-limits
 *   POST /v2/quote
 *   GET  /v2/tx/{chainId}/{txHash}
 *
 * The exact Symbiosis response field names vary between deployments/versions, so
 * every response is parsed defensively (optional chaining + fallbacks) and mapped
 * to the stable internal shapes in ./types. Where a field name is uncertain it is
 * marked with a `TODO(symbiosis)` comment citing the doc.
 */

import type {
  BridgeQuoteResponse,
  BridgeStatus,
  BridgeStatusResponse,
  BridgeTokenAmount,
  EvmBridgeTransaction,
  TonConnectMessage,
  TonConnectTransaction,
} from './types';

const DEFAULT_BASE_URL = 'https://api.symbiosis.finance/crosschain';

/** Default slippage applied when a caller does not specify one (1%). */
export const DEFAULT_SLIPPAGE_BPS = 100;

/** Error thrown for any non-2xx Symbiosis response or transport failure. */
export class BridgeError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'BridgeError';
    this.status = status;
    this.body = body;
  }
}

/** A token reference as Symbiosis expects it in request/response bodies. */
export interface SymbiosisTokenRef {
  address: string;
  chainId: number | string;
  /** Token decimals — REQUIRED by /v2/quote (a missing value is a 422). */
  decimals: number;
}

/** A token amount as Symbiosis expects it in `/v2/quote` input. */
export interface SymbiosisTokenAmountIn {
  /** Amount in the token's smallest units (base units), NOT human decimals. */
  amount: string;
  /** Symbiosis EVM-mapped token address (the field is `address`, not `token`). */
  address: string;
  chainId: number | string;
  /** Token decimals — REQUIRED by /v2/quote. */
  decimals: number;
  /**
   * Provider attributes. For a TON jetton, `attributes.ton` MUST carry the
   * jetton master address or the quote fails with "undefined has no ton address".
   */
  attributes?: { ton?: string };
}

export interface SymbiosisQuoteParams {
  tokenAmountIn: SymbiosisTokenAmountIn;
  tokenOut: SymbiosisTokenRef;
  /** Source (and refund) address — the user's TON address. */
  from: string;
  /** Destination address — the user's Privy EVM address. */
  to: string;
  /** Slippage in basis points. */
  slippageBps: number;
}

export interface SymbiosisSwapLimitsParams {
  fromChainId: number | string;
  toChainId: number | string;
  tokenIn: string;
  tokenOut: string;
}

export interface SymbiosisTxStatusParams {
  chainId: number | string;
  txHash: string;
}

/** Raw chain descriptor from GET /v1/chains (loosely typed; fields vary). */
export interface SymbiosisChain {
  id?: number | string;
  chainId?: number | string;
  name?: string;
  [key: string]: unknown;
}

/** Raw swap-limits response (loosely typed; surfaced min/max are best-effort). */
export interface SymbiosisSwapLimits {
  /** Minimum input amount in token units, when resolvable. */
  minAmount: string | null;
  /** Maximum input amount in token units, when resolvable. */
  maxAmount: string | null;
  /** Original payload for callers that need provider-specific fields. */
  raw: unknown;
}

/** Result of {@link SymbiosisClient.quote}, mapped to the stable internal shape. */
export type SymbiosisQuoteResult = BridgeQuoteResponse;

interface SymbiosisClientOptions {
  baseUrl?: string;
  partnerId?: string;
  /** Per-request timeout in ms (aborts hung upstream calls). Default 15s. */
  timeoutMs?: number;
  /** Injectable fetch for testing; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export class SymbiosisClient {
  private readonly baseUrl: string;
  private readonly partnerId: string | undefined;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: SymbiosisClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.SYMBIOSIS_API_URL ?? DEFAULT_BASE_URL).replace(
      /\/+$/,
      '',
    );
    this.partnerId = options.partnerId ?? process.env.SYMBIOSIS_PARTNER_ID ?? undefined;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** GET /v1/chains — discover supported chains, their ids and token addresses. */
  async getChains(): Promise<SymbiosisChain[]> {
    const data = await this.request<unknown>('GET', '/v1/chains');
    // Response is either a bare array or wrapped in `{ chains: [...] }`.
    // TODO(symbiosis): confirm top-level shape of /v1/chains (doc 05 §"Symbiosis REST flow sketch").
    if (Array.isArray(data)) return data as SymbiosisChain[];
    const wrapped = (data as { chains?: unknown } | null)?.chains;
    return Array.isArray(wrapped) ? (wrapped as SymbiosisChain[]) : [];
  }

  /** GET /v1/swap-limits — min/max for a given pair, surfaced to gate small dust. */
  async getSwapLimits(params: SymbiosisSwapLimitsParams): Promise<SymbiosisSwapLimits> {
    const query = new URLSearchParams({
      fromChainId: String(params.fromChainId),
      toChainId: String(params.toChainId),
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
    });
    const data = await this.request<Record<string, unknown>>(
      'GET',
      `/v1/swap-limits?${query.toString()}`,
    );
    // request() returns null on a 2xx with an empty / non-JSON body — guard so
    // pickString never dereferences null.
    const root = data ?? {};
    // TODO(symbiosis): field names for limits are not pinned in doc 05; try the
    // common spellings and fall back to null so callers can degrade gracefully.
    const min = pickString(root, ['minAmount', 'min', 'minIn', 'minTokenAmountIn']);
    const max = pickString(root, ['maxAmount', 'max', 'maxIn', 'maxTokenAmountIn']);
    return { minAmount: min, maxAmount: max, raw: root };
  }

  /**
   * POST /v2/quote — build the cross-chain swap and the TON-side transaction.
   *
   * Always sets `revertableAddress = from` so a stuck transfer refunds to the
   * user's TON address, and injects `partnerId` from the environment.
   */
  async quote(params: SymbiosisQuoteParams): Promise<SymbiosisQuoteResult> {
    const body: Record<string, unknown> = {
      tokenAmountIn: {
        amount: params.tokenAmountIn.amount,
        address: params.tokenAmountIn.address,
        chainId: params.tokenAmountIn.chainId,
        decimals: params.tokenAmountIn.decimals,
        ...(params.tokenAmountIn.attributes
          ? { attributes: params.tokenAmountIn.attributes }
          : {}),
      },
      tokenOut: {
        address: params.tokenOut.address,
        chainId: params.tokenOut.chainId,
        decimals: params.tokenOut.decimals,
      },
      from: params.from,
      to: params.to,
      // Symbiosis expects slippage in basis points.
      slippage: params.slippageBps,
      // Refund target for a stuck cross-chain leg — ALWAYS the source TON address.
      revertableAddress: params.from,
    };
    if (this.partnerId) {
      body.partnerId = this.partnerId;
    }

    const data = await this.request<Record<string, unknown>>('POST', '/v2/quote', body);
    return mapQuoteResponse(data, params);
  }

  /** GET /v2/tx/{chainId}/{txHash} — poll settlement state of the source tx. */
  async getTxStatus(params: SymbiosisTxStatusParams): Promise<BridgeStatusResponse> {
    const path = `/v2/tx/${encodeURIComponent(String(params.chainId))}/${encodeURIComponent(
      params.txHash,
    )}`;
    const data = await this.request<Record<string, unknown>>('GET', path);
    return mapStatusResponse(data, params);
  }

  /** Issue a request and throw {@link BridgeError} on any non-2xx response. */
  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: body
          ? { 'content-type': 'application/json', accept: 'application/json' }
          : { accept: 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        // Abort hung upstream calls so a Symbiosis stall can't pin a serverless
        // function for its whole max duration.
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      const timedOut = cause instanceof Error && cause.name === 'TimeoutError';
      throw new BridgeError(
        `Symbiosis request ${timedOut ? 'timed out' : 'failed'}: ${method} ${path}`,
        timedOut ? 504 : 0,
        cause instanceof Error ? cause.message : String(cause),
      );
    }

    const text = await res.text();
    const parsed = parseJson(text);

    if (!res.ok) {
      throw new BridgeError(
        `Symbiosis ${method} ${path} -> ${res.status}`,
        res.status,
        parsed ?? text,
      );
    }

    return (parsed ?? null) as T;
  }
}

/**
 * Map a raw /v2/quote response to the stable {@link BridgeQuoteResponse}.
 *
 * Exported for unit testing the (pure) field mapping without a live API.
 */
export function mapQuoteResponse(
  data: Record<string, unknown> | null,
  params: SymbiosisQuoteParams,
): BridgeQuoteResponse {
  const root = data ?? {};

  // amountOut: doc 05 calls it `tokenAmountOut`; some versions use `amountOut`.
  // TODO(symbiosis): confirm output amount key (doc 05 §3 "returns: tokenAmountOut, fee, route ...").
  const amountOut = toTokenAmount(
    firstObject(root, ['tokenAmountOut', 'amountOut', 'tokenOut']),
    {
      address: params.tokenOut.address,
      chainId: params.tokenOut.chainId,
    },
  );

  // fee: may be a token-amount object or a sum of fee entries; best-effort.
  // TODO(symbiosis): fee may be `fee`, `totalFee`, or an array `fees` (doc 05 §3).
  const feeRaw =
    firstObject(root, ['fee', 'totalFee']) ?? firstArrayHead(root, ['fees']);
  const fee = feeRaw ? toTokenAmount(feeRaw, null) : null;

  const route = root.route ?? root.routes ?? null;

  const tonTransaction = extractTonTransaction(root);
  const evmTransaction = extractEvmTransaction(root);

  const estimatedTimeSeconds = pickNumber(root, [
    'estimatedTime',
    'estimatedTimeSeconds',
    'time',
    'eta',
  ]);

  return {
    amountOut,
    fee,
    route,
    tonTransaction,
    ...(evmTransaction ? { evmTransaction } : {}),
    ...(estimatedTimeSeconds != null ? { estimatedTimeSeconds } : {}),
  };
}

/**
 * Pull the EVM-side transaction out of a quote response (the withdraw-to-TON
 * leg, where the source chain is EVM). Symbiosis returns it as a `tx` /
 * `transactionRequest` object shaped `{ to, data, value, chainId }` (no
 * `messages`, which is the TON shape). Returns null when the source is TON.
 */
function extractEvmTransaction(root: Record<string, unknown>): EvmBridgeTransaction | null {
  // Try each candidate key in order and return the FIRST that yields a valid EVM
  // tx — a single key (e.g. `transaction`) may hold a TON payload while a later
  // key (e.g. `evmTransaction`) holds the real EVM tx, so we can't stop at the
  // first present key.
  for (const k of ['tx', 'transactionRequest', 'transaction', 'evmTransaction']) {
    const candidate = root[k];
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const obj = candidate as Record<string, unknown>;
    // A TON message payload has `messages` — that's NOT an EVM tx.
    if (Array.isArray((obj as { messages?: unknown }).messages)) continue;
    const to = pickString(obj, ['to', 'address']);
    if (!to || !/^0x[0-9a-fA-F]{40}$/.test(to)) continue;
    const data = pickString(obj, ['data', 'calldata']) ?? undefined;
    const value = pickString(obj, ['value']) ?? undefined;
    const chainId = pickNumber(obj, ['chainId', 'chain_id']) ?? undefined;
    // The ERC-20 spender to approve before bridging. Symbiosis returns it at the
    // top level (`approveTo`); fall back to the tx object, then to `to`.
    const approveTo =
      pickString(root, ['approveTo', 'approve_to', 'spender', 'spenderAddress']) ??
      pickString(obj, ['approveTo', 'approve_to', 'spender', 'spenderAddress']) ??
      undefined;
    return {
      to,
      ...(data != null ? { data } : {}),
      ...(value != null ? { value } : {}),
      ...(chainId != null ? { chainId } : {}),
      ...(approveTo != null ? { approveTo } : {}),
    };
  }
  return null;
}

/**
 * Map a raw /v2/tx/{chainId}/{txHash} response to {@link BridgeStatusResponse}.
 *
 * Exported for unit testing the (pure) status mapping.
 */
export function mapStatusResponse(
  data: Record<string, unknown> | null,
  params: SymbiosisTxStatusParams,
): BridgeStatusResponse {
  const root = data ?? {};
  // TODO(symbiosis): status key is `status` per doc 05 §5; some deployments nest
  // it under `tx.status`. Try both.
  const nested = (root.tx as Record<string, unknown> | undefined) ?? undefined;
  const rawStatus =
    pickString(root, ['status', 'state']) ??
    (nested ? pickString(nested, ['status', 'state']) : null) ??
    undefined;
  const destinationTxHash =
    pickString(root, ['outHash', 'destinationTxHash', 'toTxHash', 'outboundTxHash']) ??
    undefined;

  return {
    status: normalizeStatus(rawStatus),
    ...(rawStatus != null ? { rawStatus } : {}),
    ...(destinationTxHash != null ? { destinationTxHash } : {}),
    txHash: params.txHash,
    chainId: params.chainId,
  };
}

/** Pull the TON Connect message payload out of a quote response. */
function extractTonTransaction(root: Record<string, unknown>): TonConnectTransaction | null {
  // doc 05 §3: quote returns a TON-side payload `{ messages:[{address,amount,payload}], validUntil }`.
  // It may sit at the top level or under `tx` / `transactionRequest`.
  // TODO(symbiosis): confirm the wrapper key for the TON tx (doc 05 §"SDK equivalent"
  // returns `transactionRequest`; the REST flow shows a bare payload).
  const candidate =
    firstObject(root, ['tonTransaction', 'tx', 'transactionRequest', 'transaction']) ?? root;

  const rawMessages = (candidate as { messages?: unknown }).messages;
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) return null;

  const messages: TonConnectMessage[] = [];
  for (const m of rawMessages) {
    if (!m || typeof m !== 'object') continue;
    const msg = m as Record<string, unknown>;
    const address = pickString(msg, ['address', 'to']);
    const amount = pickString(msg, ['amount', 'value']);
    if (address == null || amount == null) continue;
    const payload = pickString(msg, ['payload', 'body']) ?? undefined;
    const stateInit = pickString(msg, ['stateInit', 'state_init']) ?? undefined;
    messages.push({
      address,
      amount,
      ...(payload != null ? { payload } : {}),
      ...(stateInit != null ? { stateInit } : {}),
    });
  }
  if (messages.length === 0) return null;

  const validUntilRaw = pickNumber(candidate as Record<string, unknown>, [
    'validUntil',
    'valid_until',
  ]);
  // Default to a 10-minute window if Symbiosis omits validUntil.
  const validUntil = validUntilRaw ?? Math.floor(Date.now() / 1000) + 600;
  const network = pickString(candidate as Record<string, unknown>, ['network']) ?? undefined;

  return {
    validUntil,
    ...(network != null ? { network } : {}),
    messages,
  };
}

/** Coerce a loose token-amount object into the stable {@link BridgeTokenAmount}. */
function toTokenAmount(
  obj: Record<string, unknown> | null,
  fallback: { address: string; chainId: number | string } | null,
): BridgeTokenAmount {
  const amount = obj ? pickString(obj, ['amount', 'value', 'tokenAmount']) ?? '0' : '0';
  const nestedToken = obj?.token as Record<string, unknown> | undefined;
  const token =
    (obj ? pickString(obj, ['address', 'token', 'tokenAddress']) : null) ??
    (nestedToken ? pickString(nestedToken, ['address']) : null) ??
    fallback?.address ??
    '';
  const chainId =
    (obj ? pickNumberOrString(obj, ['chainId']) : null) ??
    (nestedToken ? pickNumberOrString(nestedToken, ['chainId']) : null) ??
    fallback?.chainId ??
    0;
  const symbol =
    (obj ? pickString(obj, ['symbol']) : null) ??
    (nestedToken ? pickString(nestedToken, ['symbol']) : null) ??
    undefined;
  const decimals =
    (obj ? pickNumber(obj, ['decimals']) : null) ??
    (nestedToken ? pickNumber(nestedToken, ['decimals']) : null) ??
    undefined;

  return {
    amount,
    token,
    chainId,
    ...(symbol != null ? { symbol } : {}),
    ...(decimals != null ? { decimals } : {}),
  };
}

/** Map a raw Symbiosis status string into the stable internal lifecycle state. */
function normalizeStatus(raw: string | undefined): BridgeStatus {
  if (!raw) return 'unknown';
  const s = raw.toLowerCase();
  if (['success', 'completed', 'done', 'confirmed', 'finished'].includes(s)) return 'success';
  if (['pending', 'processing', 'in_progress', 'inprogress', 'waiting'].includes(s)) {
    return 'pending';
  }
  if (['reverted', 'refunded', 'revert'].includes(s)) return 'reverted';
  if (['failed', 'error', 'rejected'].includes(s)) return 'failed';
  return 'unknown';
}

// --- small defensive helpers -------------------------------------------------

function parseJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.length > 0) return v;
    if (typeof v === 'number') return String(v);
  }
  return null;
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
      return Number(v);
    }
  }
  return null;
}

function pickNumberOrString(
  obj: Record<string, unknown>,
  keys: string[],
): number | string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'number' || typeof v === 'string') return v;
  }
  return null;
}

function firstObject(
  obj: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> | null {
  for (const k of keys) {
    const v = obj[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  }
  return null;
}

function firstArrayHead(
  obj: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> | null {
  for (const k of keys) {
    const v = obj[k];
    if (Array.isArray(v) && v.length > 0 && v[0] && typeof v[0] === 'object') {
      return v[0] as Record<string, unknown>;
    }
  }
  return null;
}

/** Shared singleton client for the route handlers (env-configured). */
export const symbiosis = new SymbiosisClient();

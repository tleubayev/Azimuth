/**
 * Thin client for the Compass API, reached through the app's own server proxy
 * (`/api/compass/[...path]` → `createCompassHandler`, which attaches the secret
 * API key server-side). The from-scratch trading UI calls these helpers directly
 * instead of going through `@compass-labs/widgets` React components.
 */

import type { TypedData, PerpsPrepare } from './types';

const BASE = '/api/compass';

export class CompassError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'CompassError';
    this.status = status;
  }
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string; detail?: string };
    return body.error ?? body.detail ?? `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

function qs(query?: Record<string, string | number | undefined | null>): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v != null && v !== '') params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

export async function compassGet<T>(
  path: string,
  query?: Record<string, string | number | undefined | null>,
): Promise<T> {
  const res = await fetch(`${BASE}/${path}${qs(query)}`, {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new CompassError(await readError(res), res.status);
  return (await res.json()) as T;
}

export async function compassPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new CompassError(await readError(res), res.status);
  return (await res.json()) as T;
}

/* ── snake_case / camelCase tolerant readers ───────────────────────────────── */

type Loose = Record<string, unknown>;

export function pickStr(obj: Loose | null | undefined, ...keys: string[]): string | null {
  if (!obj) return null;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.length) return v;
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return null;
}

export function pickNum(obj: Loose | null | undefined, ...keys: string[]): number | null {
  if (!obj) return null;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

export function pickBool(obj: Loose | null | undefined, ...keys: string[]): boolean | null {
  if (!obj) return null;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'boolean') return v;
  }
  return null;
}

/**
 * Perps prepare → sign → execute. Every Hyperliquid action endpoint
 * (market-order, withdraw, set-leverage, enable-unified-account,
 * approve-builder-fee) returns a signable envelope; signing the typed data and
 * POSTing the signature to `execute` commits it. The envelope key is `typedData`
 * via the widgets proxy and `typed_data` via the raw-REST custom routes — read
 * whichever is present so callers don't care which forwarder served them.
 */
export async function signAndExecutePerps(
  prepare: PerpsPrepare,
  signTypedData: (d: TypedData) => Promise<string>,
): Promise<{ status?: string }> {
  const typedData = prepare.typedData ?? prepare.typed_data;
  if (!typedData) throw new CompassError('Malformed prepare response: no typed data to sign', 502);
  const signature = await signTypedData(typedData);
  return compassPost('global-markets-perps/execute', {
    action: prepare.action,
    nonce: prepare.nonce,
    signature,
  });
}

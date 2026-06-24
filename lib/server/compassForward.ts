/**
 * Shared forwarder for Compass "prepare" endpoints (perps + tokenized-assets)
 * that the published `@compass-labs/widgets` proxy (`createCompassHandler`)
 * doesn't fully cover — either the path isn't in its route table (`set-leverage`,
 * tokenized `charge_fee`) or its wrapper drops a field we need (`market-order`
 * strips `builder`; the tokenized trade wrapper strips `fee`). These static
 * routes win over the `/api/compass/[...path]` catch-all and forward to the raw
 * Compass REST API with the secret key attached server-side.
 *
 * The raw REST API returns snake_case envelopes (`typed_data`/`eip_712`); callers
 * read whichever key applies, so they don't care which forwarder served them.
 */

import { clientIp, rateLimit, tooManyRequests } from '@/lib/server/rateLimit';

const COMPASS_API_BASE = process.env.COMPASS_API_SERVER_URL || 'https://api.compasslabs.ai';

export interface ForwardOptions {
  /** Short name for the rate-limit key + logs, e.g. "market-order". */
  name: string;
  /** Compass REST path, e.g. "v2/global_markets_perps/market_order". */
  apiPath: string;
  /** Per-IP hits per minute (default 30 — far above real usage). */
  maxPerMinute?: number;
  /** Optionally rewrite the body before forwarding (e.g. inject the builder). */
  transformBody?: (body: Record<string, unknown>) => Record<string, unknown>;
}

/** Forward a JSON POST to a Compass REST prepare endpoint with the server key. */
export async function forwardCompassPrepare(req: Request, opts: ForwardOptions): Promise<Response> {
  const limit = rateLimit(`${opts.name}:${clientIp(req)}`, opts.maxPerMinute ?? 30, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfterSeconds);

  const apiKey = process.env.COMPASS_API_KEY;
  if (!apiKey) {
    console.error(`[${opts.name}] COMPASS_API_KEY is not configured`);
    return Response.json({ error: 'Server is not configured.' }, { status: 500 });
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await req.json();
    // Reject non-object JSON (null, arrays, primitives) up front — otherwise
    // `transformBody`'s object operations would throw and 500 on valid JSON.
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  if (opts.transformBody) body = opts.transformBody(body);

  let upstream: Response;
  try {
    upstream = await fetch(`${COMPASS_API_BASE}/${opts.apiPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error(`[${opts.name}] upstream fetch failed:`, err);
    return Response.json({ error: 'Could not reach the trading service.' }, { status: 502 });
  }

  const data = (await upstream.json().catch(() => null)) as Record<string, unknown> | null;
  if (!upstream.ok) {
    return Response.json({ error: pickError(data, upstream.status) }, { status: upstream.status });
  }
  return Response.json(data ?? {});
}

/**
 * Back-compat alias for the perps prepare routes (market-order,
 * approve-builder-fee, set-leverage), which import the original name.
 */
export const forwardPerpsPrepare = forwardCompassPrepare;

/**
 * Pull the most useful string out of a Compass / FastAPI error body. Compass
 * `APIError` returns `{ error, message }` (message is the human detail);
 * FastAPI validation returns `{ detail: [{ msg }] }` or `{ detail: "..." }`.
 */
export function pickError(body: Record<string, unknown> | null, status: number): string {
  if (body) {
    if (typeof body.message === 'string' && body.message) return body.message;
    if (typeof body.error === 'string' && body.error) return body.error;
    const detail = body.detail;
    if (typeof detail === 'string' && detail) return detail;
    if (Array.isArray(detail)) {
      const msgs = detail
        .map((d) => (d && typeof d === 'object' ? (d as Record<string, unknown>).msg : null))
        .filter((m): m is string => typeof m === 'string' && m.length > 0);
      if (msgs.length) return msgs.join('. ');
    }
  }
  return `Request failed (${status})`;
}

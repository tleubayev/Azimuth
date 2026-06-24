import { consume } from '@/lib/server/nonceStore';
import { getSession, setSession } from '@/lib/server/session';
import {
  verifyTonProof,
  type TonProof,
  type VerifyTonProofArgs,
} from '@/lib/server/tonProof';

/**
 * POST /api/ton/verify
 *
 * Body:
 *   {
 *     address: string,                       // raw "0:abc…"
 *     proof: { timestamp, domain, payload, signature },
 *     walletStateInit: string,               // base64 BOC
 *     publicKey?: string                     // hex (cross-checked if present)
 *   }
 *
 * Verifies the ton_proof Ed25519 signature and policy (single-use nonce,
 * whitelisted domain, fresh timestamp), recovers the public key + address from
 * `walletStateInit`, and on success binds the TON address to the session cookie.
 * Returns `{ ok, address }`.
 */
export const runtime = 'nodejs';

/** Proof TTL in seconds (15 min). */
const PROOF_TTL_SECONDS = 900;

/**
 * Resolve the host the proof's `domain.value` must match.
 *
 * Prefer an explicit `NEXT_PUBLIC_APP_URL` allowlist (ignoring the scaffold
 * placeholder); otherwise fall back to the host this request actually arrived on
 * — the Mini App origin — mirroring the dynamic `/tonconnect-manifest.json`
 * route. The wallet signs the proof for the same origin it loaded the app from,
 * so the request host matches without any env configuration. This avoids the
 * `server_misconfigured` hard-fail when `NEXT_PUBLIC_APP_URL` is unset.
 */
function allowedDomain(req: Request): string | null {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl && !appUrl.includes('your-app.vercel.app')) {
    try {
      return new URL(appUrl).host;
    } catch {
      /* malformed env — fall through to the request host */
    }
  }
  // `x-forwarded-host` reflects the public host behind Vercel's proxy.
  const fwdHost = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  return fwdHost?.split(',')[0]?.trim() || null;
}

function isTonProof(value: unknown): value is TonProof {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const p = value as Record<string, unknown>;
  const domain = p.domain as Record<string, unknown> | undefined;
  return (
    typeof p.timestamp === 'number' &&
    typeof p.signature === 'string' &&
    typeof p.payload === 'string' &&
    typeof domain === 'object' &&
    domain !== null &&
    typeof domain.value === 'string' &&
    typeof domain.lengthBytes === 'number'
  );
}

export async function POST(req: Request): Promise<Response> {
  const domain = allowedDomain(req);
  if (!domain) {
    return Response.json(
      { ok: false, error: 'server_misconfigured' },
      { status: 500 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const { address, proof, walletStateInit, publicKey } = body;
  if (
    typeof address !== 'string' ||
    typeof walletStateInit !== 'string' ||
    !isTonProof(proof) ||
    (publicKey !== undefined && typeof publicKey !== 'string')
  ) {
    return Response.json(
      { ok: false, error: 'invalid_body' },
      { status: 400 },
    );
  }

  const args: VerifyTonProofArgs = {
    address,
    proof,
    walletStateInit,
    publicKey: publicKey as string | undefined,
  };

  const result = await verifyTonProof(args, {
    consumeNonce: consume,
    allowedDomain: domain,
    ttlSeconds: PROOF_TTL_SECONDS,
  });

  if (!result.ok) {
    return Response.json(
      { ok: false, error: result.reason },
      { status: 401 },
    );
  }

  // Bind the verified TON address onto the (possibly existing Telegram) session.
  const existing = await getSession();
  await setSession({
    telegramUserId: existing?.telegramUserId,
    tonAddress: result.address,
    issuedAt: Math.floor(Date.now() / 1000),
  });

  return Response.json({ ok: true, address: result.address });
}

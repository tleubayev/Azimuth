import { getSession } from '@/lib/server/session';

/**
 * GET /api/ton/session
 *
 * Reports whether the current (HMAC-signed) session already has a verified TON
 * address. Used by the client to restore `proofState` when the app reopens with
 * a TON wallet already connected: ton_proof only rides along on a FRESH connect,
 * so without this a restored connection would leave the UI gated even though the
 * server session (24h) is still valid. The bridge routes re-check the session
 * server-side regardless, so this is purely a UI hint.
 */
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const session = await getSession();
  return Response.json({
    verified: Boolean(session?.tonAddress),
    tonAddress: session?.tonAddress ?? null,
  });
}

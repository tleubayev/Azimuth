import { buildJwks } from '@/lib/auth/mintPrivyJwt';

/**
 * GET /.well-known/jwks.json
 *
 * Serves the public JWKS for the optional TON-keyed identity JWT so Privy (or
 * any consumer) can verify tokens minted by `mintPrivyJwt`. Inert (404) unless
 * `NEXT_PUBLIC_ENABLE_TON_KEYED_IDENTITY === 'true'` and the signing key env is
 * configured.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  if (process.env.NEXT_PUBLIC_ENABLE_TON_KEYED_IDENTITY !== 'true') {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  try {
    const jwks = await buildJwks();
    return Response.json(jwks, {
      headers: { 'Cache-Control': 'public, max-age=300' },
    });
  } catch {
    return Response.json({ error: 'jwks_unavailable' }, { status: 500 });
  }
}

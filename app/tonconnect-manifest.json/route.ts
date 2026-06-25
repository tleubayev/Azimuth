import { NextResponse } from 'next/server';

/**
 * TON Connect manifest, served dynamically so `url` / `iconUrl` always match the
 * origin the app is actually served from (prod, Vercel preview, custom domain).
 *
 * A static file with a hardcoded domain is the usual cause of the wallet's
 * "App Manifest Error" — the moment the deploy URL differs from the baked-in
 * `url`/`iconUrl` (or those still hold a placeholder), the wallet rejects the
 * manifest. Deriving them from the request host removes that whole class of bug.
 *
 * @see https://docs.tonconsole.com/academy/ton-connect/manifest
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(req: Request): Response {
  const headers = req.headers;
  const proto = headers.get('x-forwarded-proto') ?? 'https';
  // x-forwarded-host reflects the public host behind Vercel's proxy; fall back
  // to host, then to the request URL's origin.
  const host = headers.get('x-forwarded-host') ?? headers.get('host');
  const origin = host ? `${proto}://${host}` : new URL(req.url).origin;

  return NextResponse.json(
    {
      url: origin,
      name: 'azimuth',
      iconUrl: `${origin}/icon.png`,
      termsOfUseUrl: 'https://compasslabs.ai/terms',
      privacyPolicyUrl: 'https://compasslabs.ai/privacy',
    },
    {
      headers: {
        // The wallet fetches this cross-origin; keep it publicly cacheable.
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=600, s-maxage=600',
      },
    },
  );
}

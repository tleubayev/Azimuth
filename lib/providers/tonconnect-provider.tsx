'use client';

import { TonConnectUIProvider } from '@tonconnect/ui-react';
import { useMemo, type ReactNode } from 'react';

/**
 * Minimal TON Connect provider, mirroring the reference Mini App that connects
 * to in-Telegram wallets (e.g. @wallet) cleanly.
 *
 * The wallet fetches the manifest from this absolute URL, so it must resolve to
 * the origin the app is served from. We default to the live
 * `window.location.origin` (always correct on any deploy) and serve it via the
 * dynamic `/tonconnect-manifest.json` route. An explicit override is honoured
 * only when it is a real URL — the old `your-app.vercel.app` placeholder is
 * ignored so a stale env var can't point the wallet at a dead domain.
 *
 * We intentionally do NOT set `actionsConfiguration`/`twaReturnUrl` here: the
 * reference works without them, and TON Connect derives the correct in-Telegram
 * return behaviour from `window.Telegram.WebApp` (loaded in the root layout).
 */
function resolveManifestUrl(): string {
  const override = process.env.NEXT_PUBLIC_TONCONNECT_MANIFEST_URL;
  if (override && !override.includes('your-app.vercel.app')) return override;
  if (typeof window !== 'undefined') {
    return new URL('/tonconnect-manifest.json', window.location.origin).toString();
  }
  return '/tonconnect-manifest.json';
}

export function TonConnectProvider({ children }: { children: ReactNode }) {
  const manifestUrl = useMemo(resolveManifestUrl, []);
  return <TonConnectUIProvider manifestUrl={manifestUrl}>{children}</TonConnectUIProvider>;
}

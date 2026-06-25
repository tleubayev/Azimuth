'use client';

/**
 * Halliday fiat on-ramp — "Buy with card" funding source for the tokenized
 * (Stocks & RWA) deposit flow.
 *
 * Card → USDC on Ethereum delivered to the user's Privy embedded EVM wallet →
 * the existing `lib/deposit/deposit.ts` second leg (ensure per-owner Safe, then
 * ERC-20 transfer USDC in). See docs/plans/2026-06-23-halliday-onramp-integration/.
 *
 * This app holds NO Halliday key. Telegram's WebView blocks third-party KYC
 * iframes/popups, so "Buy with card" simply opens the Compass-hosted
 * `/onramp/checkout` page (in `landing_page`) in the system browser via Telegram
 * `openLink`. That hosted page is the single place the Halliday publishable key
 * lives (read server-side there). After the purchase, `useFunding`'s arrival-poll
 * picks up the delivered USDC and auto-deposits it. `buildHostedCheckoutUrl`
 * builds that URL; the key is never present in this app or in the URL.
 */

import { USDC } from '@/lib/config/chains';
import { openLink as tgOpenLink } from '@/lib/telegram/init';

/**
 * Halliday `outputs` value for USDC on Ethereum, in the `chain:address` form.
 * The canonical slug Halliday accepts is `ethereum:usdc`; the address form here is
 * pinned to the same USDC contract `USDC.ethereum` resolves to, kept for cross-checks.
 */
export const HALLIDAY_USDC_ETHEREUM = `ethereum:${USDC.ethereum}` as const;

/** Default Compass-hosted checkout origin (landing_page /onramp/checkout). */
const DEFAULT_CHECKOUT_URL = 'https://compasslabs.ai/onramp/checkout';

/**
 * Build the Compass-hosted `/onramp/checkout` URL. Query params: `destination` (the
 * embedded EOA that receives the USDC), `chain`, `asset`, and a `returnTo` deep link
 * back into the mini-app so the hosted page can offer a "return to app" affordance.
 *
 * The base origin is the public `NEXT_PUBLIC_ONRAMP_CHECKOUT_URL` (a URL, NOT a key;
 * NOT `NEXT_PUBLIC_APP_URL`, which points at THIS mini-app), falling back to
 * {@link DEFAULT_CHECKOUT_URL}. No Halliday key is ever placed in the query string —
 * the hosted page supplies its own (read server-side).
 */
export function buildHostedCheckoutUrl({ address }: { address: string }): string {
  const base = process.env.NEXT_PUBLIC_ONRAMP_CHECKOUT_URL || DEFAULT_CHECKOUT_URL;
  const url = new URL(base);
  url.searchParams.set('destination', address);
  url.searchParams.set('chain', 'ethereum');
  url.searchParams.set('asset', 'USDC');
  // Deep link back into the mini-app so the hosted page can send the user home
  // once the purchase completes. `NEXT_PUBLIC_APP_URL` is this app's origin.
  const returnTo = process.env.NEXT_PUBLIC_APP_URL;
  if (returnTo) url.searchParams.set('returnTo', returnTo);
  return url.toString();
}

/**
 * Open `url` in the system browser. Inside Telegram this routes through the native
 * `openLink` (third-party redirects/popups are blocked inside the WebView itself,
 * so the card+KYC flow must escape to the system browser); in a plain dev browser
 * it falls back to `window.open`.
 */
export function openExternal(url: string): void {
  tgOpenLink(url);
}

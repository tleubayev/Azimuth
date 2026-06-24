import type { NextConfig } from 'next';

/**
 * Content-Security-Policy tuned for a Telegram Mini App.
 *
 * Critical rules (see docs/plans/2026-06-15-telegram-ton-miniapp + research §3):
 *  - NEVER send X-Frame-Options — it has no `frame-ancestors` equivalent and
 *    would stop Telegram from framing the Mini App.
 *  - `frame-ancestors` MUST allow web.telegram.org so Telegram can embed us.
 *  - `frame-src` must allow the Privy embedded-wallet iframe + Telegram oauth.
 *  - `connect-src` must allow Privy, the TON Connect HTTP bridge, Symbiosis,
 *    Compass, and Hyperliquid.
 */
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://telegram.org https://*.telegram.org",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "frame-src 'self' https://oauth.telegram.org https://*.privy.io https://*.symbiosis.finance https://*.walletconnect.com https://*.walletconnect.org",
  "frame-ancestors https://web.telegram.org https://*.telegram.org",
  [
    'connect-src',
    "'self'",
    'https://auth.privy.io https://*.privy.io wss://*.privy.io https://*.rpc.privy.systems',
    'https://api.symbiosis.finance https://*.symbiosis.finance',
    // TON Connect: the wallets list (config.ton.org → *.ton.org) plus the
    // per-wallet HTTP/SSE bridges. Each wallet uses its OWN bridge host, so a
    // missing one silently blocks that wallet's connection (the connect response
    // never arrives → "connected" in the wallet but grey in the app):
    //   - Tonkeeper        → bridge.tonapi.io        (*.tonapi.io)
    //   - Telegram @wallet → walletbot.me            (REQUIRED for @wallet)
    //   - Tonhub           → connect.tonhubapi.com
    //   - MyTonWallet      → tonconnectbridge.mytonwallet.org
    'https://*.tonapi.io https://bridge.tonapi.io https://*.ton.org https://connect.tonhubapi.com https://*.tonkeeper.com https://walletbot.me https://tonconnectbridge.mytonwallet.org',
    'https://api.hyperliquid.xyz',
    'https://api.compasslabs.ai https://*.compasslabs.ai',
    // Scoped WebSocket origins (Privy + TON Connect wallet bridges via
    // WalletConnect / Tonkeeper); avoid a blanket wss://* wildcard.
    'wss://*.walletconnect.com wss://*.walletconnect.org wss://*.tonkeeper.com wss://*.tonapi.io',
  ].join(' '),
].join('; ');

const nextConfig: NextConfig = {
  // The widgets-sdk ships untranspiled ESM/JSX — Next must transpile it.
  transpilePackages: ['@compass-labs/widgets'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          // Deliberately NO X-Frame-Options (would block Telegram framing).
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;

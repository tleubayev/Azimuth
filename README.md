# Compass on Telegram

A **Telegram Mini App** to trade **Compass tokenized assets** (Ondo equities + Midas RWA) and
**Hyperliquid perps** from inside Telegram. The trading UI is **built from scratch** on the Compass
API and styled with the cyberpunk **Compass · Neon Terminal** design system — 3-tab bottom nav
(Spot · Perps · Profile). It does **not** embed the `@compass-labs/widgets` React components.

Telegram only exposes **TON wallets**, so the app:

1. logs the user in with **Privy** (seamless Telegram login) → an **embedded EVM wallet**,
2. connects the user's **TON wallet** via **TON Connect** (for funding),
3. **bridges TON → EVM** (Symbiosis) on Deposit and **EVM → TON** on Withdraw, and
4. signs every embedded-wallet action **server-side via Privy** (delegated key) so the
   user is **never prompted to sign** — the only user signature is the TON Connect tx
   when depositing from TON (that's the TON wallet, not Privy).

> **Server-side signing:** the embedded wallet is delegated once to the app's Privy key
> quorum (`useDelegateWallet` → `addSigners`); thereafter `usePrivyWalletAdapter`'s
> `signTypedData`/`sendTransaction` POST to `/api/privy/{sign-typed-data,send-transaction}`,
> which sign with `@privy-io/node` + the authorization key. See
> `docs/plans/2026-06-17-privy-server-signing/` and the Privy env vars in `.env.example`.

> Design & rationale: `docs/plans/2026-06-15-telegram-ton-miniapp/`
> Research: `.context/ton-miniapp-research/`

## How it works

```
Telegram WebView
  → Privy seamless Telegram login → embedded EVM wallet (signs EIP-712 / EVM tx)
  → TON Connect → connect TON wallet (+ ton_proof verified server-side)
  → Symbiosis bridge → USDC to the embedded wallet
        • Perps      → USDC on Arbitrum (Hyperliquid)
        • Tokenized  → USDC on Ethereum (Ondo/Midas)
  → from-scratch screens (components/screens/*) → /api/compass/* (createCompassHandler proxy)
```

The trading UI is hand-built (`components/ui`, `components/screens`, `components/trade`,
`components/funding`) and calls `/api/compass/*` via `lib/compass/*` + `lib/hooks/{perps,tokenized}/*`.
All signing flows through a `WalletAdapter` backed by the Privy embedded wallet
(`lib/hooks/usePrivyWalletAdapter.ts`). Withdraw bridges back to TON (`lib/hooks/useWithdraw.ts` +
`app/api/bridge/withdraw-quote`).

## Architecture map

| Layer | Files |
|-------|-------|
| Telegram init | `lib/telegram/init.ts`, `lib/providers/telegram-provider.tsx` |
| Privy embedded wallet | `lib/providers/privy-provider.tsx`, `lib/hooks/usePrivyWalletAdapter.ts`, `lib/auth/useTelegramLogin.ts`, `lib/contexts/wallet-context.tsx` |
| TON Connect | `lib/providers/tonconnect-provider.tsx`, `lib/hooks/useTon.ts` |
| Bridge (Symbiosis) | `lib/bridge/*`, `app/api/bridge/{quote,status,withdraw-quote}/route.ts`, `lib/hooks/{useFunding,useWithdraw}.ts`, `components/funding/{DepositSheet,WithdrawSheet,funding-context}.tsx` |
| Auth verification | `app/api/telegram/verify`, `app/api/ton/{nonce,verify}`, `lib/server/*`, `lib/auth/mintPrivyJwt.ts` |
| Compass proxy | `app/api/compass/[...path]/route.ts` (`createCompassHandler`) |
| Trading data | `lib/compass/{client,types}.ts`, `lib/hooks/perps/*`, `lib/hooks/tokenized/*` |
| Trading UI | `components/screens/{Spot,Perps,Profile}Screen.tsx`, `components/trade/*` (trade sheets, asset detail, candle chart) |
| Design system | `app/globals.css` (Neon Terminal tokens), `components/ui/index.tsx` (primitives), kit in `.context/design/` |
| Shell / onboarding | `components/shell/AppShell.tsx` (3-tab nav), `components/onboarding/OnboardingFlow.tsx` |

## Develop

```bash
cp .env.example .env.local   # fill in the vars below
npm install
npm run dev                  # http://localhost:3000
npm run typecheck
npm run lint
npm test                     # vitest (auth + bridge unit tests)
npm run build
```

Telegram-only features (seamless login, TON Connect deep-links, safe-area) need the app to be
opened **inside Telegram over HTTPS**. For local testing use a tunnel (e.g. `ngrok http 3000`) and
point a BotFather **test** Mini App at the tunnel URL.

## Setup runbook (to run end-to-end)

### 1. BotFather (Telegram)
1. `/newbot` → get the **bot token** (server-only HMAC key → `TELEGRAM_BOT_TOKEN`).
2. `/newapp` (or `/setmenubutton`) → attach the **HTTPS Web App URL** (your Vercel URL).
3. `/setdomain` → register the app domain. **Do not use a `.xyz` domain** (Telegram auth rejects it).

### 2. Privy dashboard
1. Create an app → copy the **App ID** → `NEXT_PUBLIC_PRIVY_APP_ID`.
2. **Login methods**: enable **Telegram** only (paste the bot token + handle, enable seamless/Mini-App login). Telegram is the sole sign-in method — do *not* enable email, social OAuth or passkeys (popup-based flows are blocked in the Telegram WebView).
3. **Embedded wallets**: Ethereum, `createOnLogin = all-users` (already set in code). The code also sets `showWalletUIs: false` so embedded-wallet confirmation modals (including the one-time delegation prompt) never surface — all signing is server-side.
4. **Server-side signing (no sign prompts)** — required so the user is never prompted by Privy:
   - Create an **authorization key / key quorum** → put its **id** in `NEXT_PUBLIC_PRIVY_AUTHORIZATION_KEY_ID` (client, used by `useDelegateWallet`) and its **private key** in `PRIVY_AUTHORIZATION_KEY` (server, used by `lib/server/privy.ts`). Also set `PRIVY_APP_ID` + `PRIVY_APP_SECRET`.
   - **Eliminate the one-time delegation prompt** by making the embedded wallet delegated to that key quorum **without** an on-device confirmation. Do **at least one** of: (a) enable **automatic delegation of embedded wallets at creation** to the key quorum, OR (b) put the app on the **user-controlled server wallets (TEE)** execution stack — on the legacy on-device stack, granting a signer can require a one-time owner confirmation that `showWalletUIs: false` hides but cannot fully guarantee. This setting lives only in the dashboard and cannot be configured from the repo.
5. **Domains**: add `https://web.telegram.org` and your production origin.
6. *(optional, TON-keyed identity)* enable **JWT-based auth**, set the JWKS URL to `https://<app>/.well-known/jwks.json`, and set `NEXT_PUBLIC_ENABLE_TON_KEYED_IDENTITY=true` + the `PRIVY_JWT_*` env vars. You must also add a `/api/ton/privy-token` route that mints the JWT (via `lib/auth/mintPrivyJwt.ts`) for the verified TON session.

### 3. Symbiosis (bridge)
- Request a `partnerId` / client id for fee attribution → `SYMBIOSIS_PARTNER_ID` / `NEXT_PUBLIC_SYMBIOSIS_CLIENT_ID`.

### 4. Compass
- `COMPASS_API_KEY` (server-only; the `/api/compass/*` proxy attaches it as `x-api-key`).
- RPC URLs for gas-sponsored writes: `ETHEREUM_MAINNET_RPC_URL`, `ARBITRUM_MAINNET_RPC_URL`, `BASE_MAINNET_RPC_URL`, `HYPEREVM_MAINNET_RPC_URL`; optional `GAS_SPONSOR_PK`.

### 5. TON Connect manifest
- The manifest is served dynamically at `/tonconnect-manifest.json` (`app/tonconnect-manifest.json/route.ts`) and derives `url`/`iconUrl` from the request origin, so it always matches the deploy domain — no static file to edit. The icon is `public/icon.png`.
- Set `NEXT_PUBLIC_APP_URL` to the real origin (it's also the allowed `ton_proof` domain) and `NEXT_PUBLIC_TELEGRAM_BOT`. Leave `NEXT_PUBLIC_TONCONNECT_MANIFEST_URL` unset unless you must point the wallet at a different absolute manifest URL.

### 6. Deploy (Vercel)
- Set all env vars, deploy over HTTPS. The CSP in `next.config.ts` allows Telegram framing (`frame-ancestors web.telegram.org`) and **omits `X-Frame-Options`** — do not re-add it.
- Verify `https://<app>/tonconnect-manifest.json` is publicly reachable.

## Manual verification checklist (needs credentials + deploy)

- [ ] Open the Mini App in Telegram → seamless login produces an EVM address (header chip).
- [ ] Connect a TON wallet → `ton_proof` verifies (TON ✓ chip).
- [ ] "Add funds" → quote shows → sign in TON wallet → USDC appears in the embedded wallet.
- [ ] Perps tab loads live Hyperliquid markets; place a small order (USDC@Arbitrum).
- [ ] Stocks & RWA tab loads live markets; place a small tokenized order (USDC@Ethereum).
- [ ] Withdraw → enter amount → funds pulled from product to embedded wallet → bridged EVM→TON → arrives in TON wallet.

## Notes / known constraints
- The TON Connect `sendTransaction` returns a signed BoC, not an on-chain hash, so bridge settlement
  is surfaced as "submitted" and the trade screen reacts to the embedded wallet's USDC balance. A
  precise status poller can be added once a source tx id is resolvable (see `lib/hooks/useBridge.ts`).
- Symbiosis response field names vary by version; `lib/bridge/symbiosis.ts` maps defensively with
  `TODO(symbiosis)` markers — re-check against the live API before production.
- `env(safe-area-inset-*)` is broken in Telegram; we bind Telegram's `safeAreaInset` to CSS vars in
  `lib/telegram/init.ts` (consumed by `.tg-app` in `app/globals.css`).

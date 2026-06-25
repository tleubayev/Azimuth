# Telegram Mini App (Compass on Telegram)

A standalone Next.js Telegram Mini App that lets a Telegram user trade **Compass tokenized assets**
and **Hyperliquid perps**, funded from their **TON wallet**. The trading UI is **built from scratch**
against the Compass API (through the `/api/compass/*` proxy) and styled with the cyberpunk
**Compass · Neon Terminal** design system — it does **not** use the `@compass-labs/widgets` React
components. 3-tab bottom nav: **Spot** (tokenized RWA/equities) · **Perps** · **Profile**.

## Purpose

Telegram exposes only **TON wallets**. This app bridges that gap to the EVM-only Compass API:

- **Privy** seamless Telegram login → an **embedded EVM wallet** (the signer for all trades).
- **TON Connect** connects the user's TON wallet (with server-verified `ton_proof`) for funding.
- **Symbiosis** bridges TON → EVM on **Deposit** (USDC on Arbitrum for perps, Ethereum for tokenized)
  and **EVM → TON** on **Withdraw** (product → embedded wallet → TON).
- The from-scratch components sign EIP-712 / send EVM tx via a `WalletAdapter` backed by the Privy wallet.
- **Server-side signing (no user prompts):** the embedded wallet is delegated once to the app's Privy
  key quorum (`useDelegateWallet`/`addSigners`); the adapter's `signTypedData`/`sendTransaction` then POST
  to `/api/privy/{sign-typed-data,send-transaction}`, which sign with `@privy-io/node` + the authorization
  key (`lib/server/privy.ts`). The user is never prompted to sign via Privy — TON Connect (deposit-from-TON)
  is the only remaining user signature. Design: `docs/plans/2026-06-17-privy-server-signing/`.

## Tech Stack

| Component | Technology |
|-----------|------------|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS v4 + **Compass Neon Terminal** tokens (`app/globals.css`, design kit in `.context/design/`) |
| UI | Hand-built primitives (`components/ui/`) + screens (`components/screens/`) + sheets (`components/trade/`, `components/funding/`) |
| Data | `lib/compass/*` + `lib/hooks/{perps,tokenized}/*` calling `/api/compass/*` directly (React Query) |
| Wallet | Privy embedded EVM wallet (`usePrivyWalletAdapter`) |
| TON | `@tonconnect/ui-react`, `@telegram-apps/sdk-react` |
| Bridge | Symbiosis REST API (TON→EVM deposit + EVM→TON withdraw) |
| Compass | `@compass-labs/widgets/server` (`createCompassHandler` proxy) + `WalletAdapter` type **only** — no React widgets |
| Tests | Vitest |

## Develop

```bash
cp .env.example .env.local   # fill in COMPASS_API_KEY, NEXT_PUBLIC_PRIVY_APP_ID, TELEGRAM_BOT_TOKEN, ...
npm install
npm run dev
npm run typecheck && npm run lint && npm test && npm run build
```

See `README.md` for the full BotFather / Privy / Symbiosis / Vercel setup runbook.

## Relationship to widgets-sdk

The **React widgets are NOT used** — the trading UI is rebuilt from scratch. We still depend on the
npm-published `@compass-labs/widgets` for two things only: the **server proxy**
(`createCompassHandler` in `app/api/compass/[...path]/route.ts`, which keeps the API key server-side)
and the `WalletAdapter` / `TypedDataToSign` **types** used by `lib/hooks/usePrivyWalletAdapter.ts` and
`lib/compass/*`. The functional behavior mirrors `TraditionalInvestingWidget` (perps) and
`TokenizedAssetsWidget` (tokenized) — see those for the canonical API sequences. Design system + the
recreated screens live in `.context/design/` (the "Compass · Neon Terminal" kit). Redesign plan:
`docs/plans/2026-06-17-telegram-neon-terminal/`.

## Key constraints (Telegram WebView)

- Only TON wallets; no injected EVM provider; OAuth popups + passkeys blocked → Telegram seamless
  login is the sole sign-in method (no email/OAuth fallback).
- Never set `X-Frame-Options`; CSP must allow `frame-ancestors web.telegram.org` (see `next.config.ts`).
- `env(safe-area-inset-*)` is broken — bind Telegram `safeAreaInset` to CSS vars (`lib/telegram/init.ts`).
- HMAC-verify `initData` server-side; verify `ton_proof` (Ed25519) before trusting a TON address.
- "Buy with card" (Halliday fiat on-ramp, tokenized/Ethereum only): the hosted KYC iframe is
  expected to be blocked in the WebView, so the PRIMARY path opens the Compass-hosted
  `/onramp/checkout` in the system browser via `openLink`, then reuses `useFunding`'s
  arrival-poll to auto-deposit the delivered USDC. See
  `docs/plans/2026-06-23-halliday-onramp-integration/04-telegram-miniapp-buy-with-card.md`.

## Planning Convention

Follow the documentation convention in the root `CLAUDE.md` for any new features (plans in
`docs/plans/`, task breakdowns, blocker diagrams, `docs/TRACKER.yaml`). The design for this app lives
in `docs/plans/2026-06-15-telegram-ton-miniapp/`.

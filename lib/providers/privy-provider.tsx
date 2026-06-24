'use client';

import { PrivyProvider as PrivyProviderBase } from '@privy-io/react-auth';
import type { PrivyClientConfig } from '@privy-io/react-auth';
import { mainnet, base, arbitrum, hyperEvm, arbitrumSepolia } from 'viem/chains';
import { hyperliquidL1 } from '../hooks/usePrivyWalletAdapter';

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
const TON_KEYED = process.env.NEXT_PUBLIC_ENABLE_TON_KEYED_IDENTITY === 'true';

/**
 * Optional TON-keyed identity (custom auth): exchange the verified TON session
 * for a Privy JWT minted by our backend (sub = TON address). Returns undefined
 * when not enabled / not yet available, which keeps Privy unauthenticated.
 */
async function getCustomAccessToken(): Promise<string | undefined> {
  try {
    const res = await fetch('/api/ton/privy-token');
    if (!res.ok) return undefined;
    const { token } = (await res.json()) as { token?: string };
    return token ?? undefined;
  } catch {
    return undefined;
  }
}

export function PrivyProvider({ children }: { children: React.ReactNode }) {
  // Without an app id there is no Privy context, so the wallet tree beneath us
  // would crash on usePrivy(). Show a clear config notice instead of children.
  if (!PRIVY_APP_ID) {
    return (
      <div className="tg-app flex min-h-dvh flex-col items-center justify-center gap-3 p-8 text-center">
        <h1 className="text-lg font-semibold">Configuration needed</h1>
        <p className="max-w-xs text-sm muted">
          Set <code>NEXT_PUBLIC_PRIVY_APP_ID</code> in <code>.env.local</code> to enable the
          embedded wallet. See the README.
        </p>
      </div>
    );
  }

  const config: PrivyClientConfig = {
    appearance: {
      theme: 'dark',
      accentColor: '#8b5cf6',
      walletChainType: 'ethereum-only',
    },
    embeddedWallets: {
      ethereum: { createOnLogin: 'all-users' },
      // Server-side signing: the embedded wallet is delegated to the app's key
      // quorum and ALL signing happens server-side (lib/server/privy.ts), so the
      // user must never see a Privy confirmation modal. `showWalletUIs: false`
      // hides every embedded-wallet UI — including the one-time delegation
      // confirmation (useDelegateWallet) — so the on-device key authorizes
      // headlessly instead of prompting. The most robust setup ALSO enables
      // auto-delegation at wallet creation (or the TEE / user-controlled-server-
      // wallets stack) in the Privy dashboard so the signer is present at birth.
      showWalletUIs: false,
    },
    // Default to Arbitrum (perps funding chain); widgets switch as needed.
    defaultChain: arbitrum,
    supportedChains: [arbitrum, mainnet, base, hyperEvm, hyperliquidL1, arbitrumSepolia],
    ...(TON_KEYED
      ? {
          // EXPERIMENTAL TON-keyed identity: the embedded wallet is keyed to the
          // TON address via a backend-minted JWT (getCustomAccessToken). We keep
          // `loginMethods: ['telegram']` as a fallback so that if the TON proof
          // JWT is not yet available (proof unverified, transient network) the
          // user is not stranded with no way to authenticate.
          // NOTE: `isLoading` is static here; productionizing this mode should
          // drive it from real token-loading state (see plan task 04 / README).
          customAuth: { isLoading: false, getCustomAccessToken },
          loginMethods: ['telegram'],
        }
      : // Telegram seamless login is popup-free (works in the WebView). Email,
        // OAuth and passkeys are intentionally excluded — Telegram only.
        { loginMethods: ['telegram'] }),
  };

  return (
    <PrivyProviderBase appId={PRIVY_APP_ID} config={config}>
      {children}
    </PrivyProviderBase>
  );
}

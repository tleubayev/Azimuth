'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import type { WalletAdapter } from '@compass-labs/widgets';
import { usePrivyWalletAdapter } from '@/lib/hooks/usePrivyWalletAdapter';
import { useDelegateWallet } from '@/lib/hooks/useDelegateWallet';
import { useTelegramLogin, type TgLoginState } from '@/lib/auth/useTelegramLogin';

interface WalletContextValue {
  /** The widgets-sdk WalletAdapter, backed by the Privy embedded EVM wallet. */
  adapter: WalletAdapter;
  /** The embedded EVM address (bridge destination + widget signer), or null. */
  evmAddress: `0x${string}` | null;
  /** Privy ready + authenticated state. */
  ready: boolean;
  authenticated: boolean;
  /** Seamless Telegram login progress (for onboarding UI). */
  loginState: TgLoginState;
  loginError: string | null;
  retryLogin: () => void | Promise<void>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const adapter = usePrivyWalletAdapter();
  const { ready, authenticated } = usePrivy();
  // Drives the auto seamless-login effect app-wide.
  const { state: loginState, error: loginError, retry } = useTelegramLogin();
  // One-time delegation so the server can sign for the embedded wallet (no prompts).
  useDelegateWallet();

  const value = useMemo<WalletContextValue>(
    () => ({
      adapter,
      evmAddress: (adapter.address as `0x${string}` | null) ?? null,
      ready,
      authenticated,
      loginState,
      loginError,
      retryLogin: retry,
    }),
    [adapter, ready, authenticated, loginState, loginError, retry],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used within <WalletProvider>');
  return ctx;
}

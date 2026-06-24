'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import { useState, type ReactNode } from 'react';
import { TelegramProvider } from '@/lib/providers/telegram-provider';
import { TonConnectProvider } from '@/lib/providers/tonconnect-provider';

// Privy (and the wallet hooks beneath it) are client-only — loading it with
// ssr:false avoids prerendering the wallet tree on the server.
const PrivyProvider = dynamic(
  () => import('@/lib/providers/privy-provider').then((m) => m.PrivyProvider),
  { ssr: false },
);
import { WalletProvider } from '@/lib/contexts/wallet-context';
import { FundingProvider } from '@/components/funding/funding-context';

/**
 * Root client provider tree.
 *
 *   TelegramProvider  — SDK init, initData, safe-area
 *     QueryClient
 *       TonConnectProvider — TON wallet connection (mounted top-level, like the
 *                            reference Mini App, so TON Connect initializes
 *                            immediately rather than behind the lazy Privy import)
 *         PrivyProvider     — embedded EVM wallet (seamless Telegram login)
 *           WalletProvider   — WalletAdapter + auto seamless-login
 *             FundingProvider — shared "Add funds" sheet
 *
 * TonConnectProvider sits ABOVE PrivyProvider on purpose: PrivyProvider is a
 * `dynamic(ssr:false)` import, so anything nested under it only mounts after the
 * chunk resolves. TON Connect needs to come up early (and consistently with a
 * working reference app) for the in-Telegram wallet handshake to land, so it
 * wraps Privy instead of nesting inside it. Nothing in the TON layer depends on
 * Privy; the funding flow (which needs both) stays inside both.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, gcTime: 120_000, refetchOnWindowFocus: false },
        },
      }),
  );

  return (
    <TelegramProvider>
      <QueryClientProvider client={queryClient}>
        <TonConnectProvider>
          <PrivyProvider>
            <WalletProvider>
              <FundingProvider>{children}</FundingProvider>
            </WalletProvider>
          </PrivyProvider>
        </TonConnectProvider>
      </QueryClientProvider>
    </TelegramProvider>
  );
}

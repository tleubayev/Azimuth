'use client';

import { useEffect, useRef } from 'react';
import { usePrivy, useWallets, useSigners } from '@privy-io/react-auth';

/**
 * One-time delegation: add the app's authorization key (a Privy "key quorum") as
 * a signer on the user's embedded wallet, so the SERVER can sign every action
 * without ever prompting the user (see lib/server/privy.ts + /api/privy/*).
 *
 * `NEXT_PUBLIC_PRIVY_AUTHORIZATION_KEY_ID` is the key quorum id. For a fully
 * prompt-free experience, also enable automatic server delegation at wallet
 * creation in the Privy dashboard — then this is a no-op/instant.
 */
const SIGNER_ID = process.env.NEXT_PUBLIC_PRIVY_AUTHORIZATION_KEY_ID;

/**
 * Decide whether a failed `addSigners` should be RETRIED on the next wallet
 * change. We retry ONLY on clearly transient infrastructure errors (network
 * blip, timeout, rate limit, 5xx). Everything else — already-delegated, a
 * user-dismissed confirmation, a permission/config error — is treated as
 * terminal: we keep `delegatedFor` set so the effect does NOT re-invoke
 * `addSigners` (which, on the legacy on-device wallet stack, could re-surface a
 * confirmation prompt) in a loop. Server signing still fails loudly later if the
 * wallet was truly never granted, so a missed delegation is observable.
 */
function isTransient(err: unknown): boolean {
  const message = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    message.includes('network') ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('failed to fetch') ||
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    /\b(429|5\d\d)\b/.test(message)
  );
}

export function useDelegateWallet(): void {
  const { authenticated } = usePrivy();
  const { wallets } = useWallets();
  const { addSigners } = useSigners();
  const delegatedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!authenticated || !SIGNER_ID) return;
    // Embedded Privy wallets report walletClientType starting with 'privy'.
    const embedded = wallets.find((w) => w.walletClientType?.startsWith('privy') && w.type === 'ethereum');
    const address = embedded?.address;
    if (!address || delegatedFor.current === address) return;

    delegatedFor.current = address;
    void addSigners({ address, signers: [{ signerId: SIGNER_ID, policyIds: [] }] }).catch((err) => {
      // Retry only on transient errors; keep `delegatedFor` set otherwise so we
      // never re-fire addSigners (and risk a repeat prompt) on the next change.
      if (isTransient(err)) delegatedFor.current = null;
    });
  }, [authenticated, wallets, addSigners]);
}

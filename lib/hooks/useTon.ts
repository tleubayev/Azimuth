'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useTonAddress,
  useTonConnectUI,
  useTonWallet,
} from '@tonconnect/ui-react';
import type { SendTransactionRequest } from '@tonconnect/ui-react';

export type TonProofState = 'idle' | 'pending' | 'verified' | 'failed';

interface VerifyOutcome {
  ok: boolean;
  error?: string;
}

/**
 * Shared, deduped ton_proof verification — keyed by the single-use nonce.
 *
 * `useTon` is consumed by several components at once (header chip, AddFunds
 * sheet, funding hook). Each instance runs the verify effect, but a ton_proof
 * nonce is SINGLE-USE: if every instance POSTed the same proof, the first would
 * succeed and the rest would get `nonce_invalid` and flip to `failed`. By
 * sharing one in-flight promise (and caching successes) per nonce, the proof is
 * verified exactly once and every instance observes the same outcome.
 */
const verifyInflight = new Map<string, Promise<VerifyOutcome>>();
const verifyResults = new Map<string, VerifyOutcome>();

function verifyProofShared(nonce: string, body: unknown): Promise<VerifyOutcome> {
  const cached = verifyResults.get(nonce);
  if (cached) return Promise.resolve(cached);

  let inflight = verifyInflight.get(nonce);
  if (!inflight) {
    inflight = fetch('/api/ton/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then((r) => r.json() as Promise<VerifyOutcome>)
      .then((d) => {
        const outcome: VerifyOutcome = { ok: Boolean(d.ok), error: d.error };
        // Cache successes so a late-mounting instance reuses the result instead
        // of re-POSTing a now-spent nonce. Failures aren't cached: domain/config
        // errors don't consume the nonce, so a retry re-reports the real reason.
        if (outcome.ok) verifyResults.set(nonce, outcome);
        return outcome;
      })
      .catch((): VerifyOutcome => ({ ok: false, error: 'network_error' }))
      .finally(() => verifyInflight.delete(nonce));
    verifyInflight.set(nonce, inflight);
  }
  return inflight;
}

/**
 * Wraps the TON Connect hooks and runs the ton_proof handshake:
 *  1. fetch a single-use nonce from /api/ton/nonce
 *  2. ask the wallet to sign it (setConnectRequestParameters) at connect time
 *  3. POST the returned proof to /api/ton/verify so the backend trusts the address
 */
export function useTon() {
  const [tonConnectUI] = useTonConnectUI();
  const tonAddress = useTonAddress(); // user-friendly (bounceable) address, '' when disconnected
  const wallet = useTonWallet();
  const [proofState, setProofState] = useState<TonProofState>('idle');
  // The exact `/api/ton/verify` rejection reason (e.g. 'domain_mismatch',
  // 'server_misconfigured', 'nonce_invalid') — surfaced for debugging.
  const [proofError, setProofError] = useState<string | null>(null);
  const verifiedFor = useRef<string | null>(null);

  // Load a fresh nonce and arm the next connect request with ton_proof.
  const refreshProofPayload = useCallback(async () => {
    try {
      tonConnectUI.setConnectRequestParameters({ state: 'loading' });
      const res = await fetch('/api/ton/nonce');
      const { nonce } = (await res.json()) as { nonce?: string };
      if (nonce) {
        tonConnectUI.setConnectRequestParameters({ state: 'ready', value: { tonProof: nonce } });
      } else {
        tonConnectUI.setConnectRequestParameters(null);
      }
    } catch {
      tonConnectUI.setConnectRequestParameters(null);
    }
  }, [tonConnectUI]);

  useEffect(() => {
    void refreshProofPayload();
  }, [refreshProofPayload]);

  // When a wallet connects with a ton_proof, verify it server-side.
  useEffect(() => {
    if (!wallet || !tonAddress) {
      setProofState('idle');
      setProofError(null);
      verifiedFor.current = null;
      return;
    }
    const addr = wallet.account.address;
    const items = wallet.connectItems;
    const proof =
      items?.tonProof && 'proof' in items.tonProof ? items.tonProof.proof : null;

    // Restored connection: ton_proof only rides along on a FRESH connect, so a
    // reopened app has no proof here. Don't leave the UI gated — ask the server
    // whether the (24h) session is already verified for this address and reflect
    // it. The bridge routes still re-check the session server-side.
    if (!proof) {
      if (verifiedFor.current === addr) return;
      let cancelled = false;
      fetch('/api/ton/session')
        .then((r) => r.json())
        .then((d: { verified?: boolean; tonAddress?: string | null }) => {
          if (cancelled) return;
          if (d.verified && d.tonAddress === addr) {
            verifiedFor.current = addr;
            setProofState('verified');
            setProofError(null);
          }
        })
        .catch(() => {
          /* leave idle; user can reconnect to produce a fresh proof */
        });
      return () => {
        cancelled = true;
      };
    }

    // Key on the nonce: a new connect → new nonce → re-verify. Guards this
    // instance against re-firing for a proof it already handled.
    const nonce = proof.payload;
    if (verifiedFor.current === nonce) return;
    verifiedFor.current = nonce;
    setProofState('pending');
    setProofError(null);

    let cancelled = false;
    void verifyProofShared(nonce, {
      address: addr,
      publicKey: wallet.account.publicKey,
      walletStateInit: wallet.account.walletStateInit,
      proof,
    }).then((outcome) => {
      if (cancelled) return;
      if (outcome.ok) {
        setProofState('verified');
        setProofError(null);
      } else {
        setProofState('failed');
        setProofError(outcome.error ?? 'verify_failed');
        // Re-arm a fresh nonce so a manual reconnect can retry.
        verifiedFor.current = null;
        void refreshProofPayload();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [wallet, tonAddress, refreshProofPayload]);

  const connect = useCallback(async () => {
    await refreshProofPayload();
    await tonConnectUI.openModal();
  }, [tonConnectUI, refreshProofPayload]);

  const disconnect = useCallback(async () => {
    try {
      await tonConnectUI.disconnect();
    } catch {
      /* already disconnected */
    }
    verifiedFor.current = null;
    setProofState('idle');
    void refreshProofPayload();
  }, [tonConnectUI, refreshProofPayload]);

  const sendTransaction = useCallback(
    (tx: SendTransactionRequest) => tonConnectUI.sendTransaction(tx),
    [tonConnectUI],
  );

  return {
    tonAddress,
    rawTonAddress: wallet?.account.address ?? null,
    connected: Boolean(tonAddress),
    wallet,
    proofState,
    proofError,
    connect,
    disconnect,
    sendTransaction,
  };
}

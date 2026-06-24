'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { initTelegram, getRawInitData, getLaunchParams, syncSafeArea } from '@/lib/telegram/init';

export interface TelegramUser {
  id: number;
  firstName?: string;
  lastName?: string;
  username?: string;
  photoUrl?: string;
}

interface TelegramContextValue {
  /** SDK init attempted (client mounted). */
  ready: boolean;
  /** Running inside a Telegram Mini App (vs a plain browser dev session). */
  isTelegram: boolean;
  /** Raw initData string for backend HMAC verification (may be stale — re-read before use). */
  initDataRaw: string | null;
  /** Parsed Telegram user, if available. */
  user: TelegramUser | null;
}

const TelegramContext = createContext<TelegramContextValue>({
  ready: false,
  isTelegram: false,
  initDataRaw: null,
  user: null,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseUser(lp: any): TelegramUser | null {
  const u = lp?.tgWebAppData?.user ?? lp?.initData?.user ?? lp?.user;
  if (!u || typeof u.id !== 'number') return null;
  return {
    id: u.id,
    firstName: u.first_name ?? u.firstName,
    lastName: u.last_name ?? u.lastName,
    username: u.username,
    photoUrl: u.photo_url ?? u.photoUrl,
  };
}

export function TelegramProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TelegramContextValue>({
    ready: false,
    isTelegram: false,
    initDataRaw: null,
    user: null,
  });

  useEffect(() => {
    const { isTelegram } = initTelegram();
    const initDataRaw = getRawInitData();
    setState({
      ready: true,
      isTelegram,
      initDataRaw,
      user: parseUser(getLaunchParams()),
    });

    // Self-heal the server signing session from the always-present Telegram
    // identity. The Mini App launches with fresh initData on every open, so POST
    // it once to mint/refresh the HMAC session cookie (telegramUserId) that gates
    // server-side signing. Without this the session lived only as long as the 24h
    // ton_proof cookie, so signing 401'd ("verify your wallet first") once it
    // lapsed — even though reads (API-key proxy) kept working. Fail-open: on any
    // error the ton_proof connect remains the alternative way to get a session.
    if (initDataRaw) {
      void fetch('/api/telegram/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ initDataRaw }),
      }).catch(() => {
        /* fail-open */
      });
    }

    // Re-sync safe-area on viewport changes (debounced).
    let t: ReturnType<typeof setTimeout> | null = null;
    const onResize = () => {
      if (t) clearTimeout(t);
      t = setTimeout(syncSafeArea, 100);
    };
    window.addEventListener('resize', onResize);
    return () => {
      if (t) clearTimeout(t);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  const value = useMemo(() => state, [state]);
  return <TelegramContext.Provider value={value}>{children}</TelegramContext.Provider>;
}

export function useTelegram(): TelegramContextValue {
  return useContext(TelegramContext);
}

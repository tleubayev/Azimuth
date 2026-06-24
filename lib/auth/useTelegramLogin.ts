'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useTelegram } from '@/lib/providers/telegram-provider';

export type TgLoginState = 'idle' | 'logging-in' | 'done' | 'error';

/** How long to wait for Privy's seamless login before surfacing the fallback UI. */
const SEAMLESS_GRACE_MS = 8000;

/**
 * Seamless Telegram → Privy login (Mini App).
 *
 * Inside a Telegram Mini App, Privy authenticates the user *automatically* on
 * init: it reads the Telegram launch params from `window.location.hash`
 * (`#tgWebAppData=…`) and, when "seamless Mini-App login" is enabled in the
 * Privy dashboard, provisions the embedded EVM wallet — no client call needed.
 *
 * We MUST NOT call `useLoginWithTelegram().login()` here: that hook drives the
 * *website* Telegram Login Widget, which authenticates via
 * `window.Telegram.Login.auth(...)`. That object only exists when Telegram's
 * `telegram-widget.js` is loaded on a normal web page — inside the Telegram
 * WebView `window.Telegram` is the Mini App bridge (`.WebApp`) and has no
 * `.Login`, so the call throws "undefined is not an object (evaluating
 * 'window.Telegram.Login.auth')".
 *
 * So this hook only *reflects* Privy's seamless-login progress and exposes a
 * retry (a reload, which re-runs Privy's launch-param detection with the hash
 * still intact). Telegram is the only sign-in method — there is no email/OAuth
 * fallback.
 */
export function useTelegramLogin() {
  const { ready, authenticated } = usePrivy();
  const { isTelegram } = useTelegram();
  const [timedOut, setTimedOut] = useState(false);

  // While Privy is initializing / running its seamless flow we show progress;
  // if it hasn't authenticated within the grace window, fall through to the
  // fallback UI (likely seamless login is disabled in the dashboard, or we're
  // not actually inside Telegram).
  useEffect(() => {
    if (!ready || authenticated || !isTelegram) {
      setTimedOut(false);
      return;
    }
    const t = setTimeout(() => setTimedOut(true), SEAMLESS_GRACE_MS);
    return () => clearTimeout(t);
  }, [ready, authenticated, isTelegram]);

  // There is no client API to (re)trigger Privy's seamless login — it only runs
  // during init. Reloading re-runs detection; the launch-param hash survives a
  // reload of the Mini App URL.
  const retry = useCallback(() => {
    if (typeof window !== 'undefined') window.location.reload();
  }, []);

  const state: TgLoginState = authenticated
    ? 'done'
    : !ready || (isTelegram && !timedOut)
      ? 'logging-in'
      : 'idle';

  return { state, error: null as string | null, retry, authenticated, ready };
}

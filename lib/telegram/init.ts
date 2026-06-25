'use client';

/**
 * Defensive Telegram Mini App SDK bootstrap.
 *
 * The @telegram-apps/sdk-react v3 surface differs slightly across minor
 * versions (mount vs mountSync, signal getters), and many calls throw when the
 * app is NOT running inside Telegram (e.g. local `npm run dev` in a browser).
 * So every SDK call here is feature-detected + wrapped in try/catch: in
 * Telegram we get the full experience; in a plain browser we degrade to a
 * usable dev fallback instead of crashing.
 */
import {
  init,
  isTMA,
  retrieveRawInitData,
  retrieveLaunchParams,
  bindThemeParamsCssVars,
  bindViewportCssVars,
  miniApp,
  themeParams,
  viewport,
  openLink as tmaOpenLink,
  openTelegramLink as tmaOpenTelegramLink,
} from '@telegram-apps/sdk-react';

export interface TelegramEnv {
  isTelegram: boolean;
  initDataRaw: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tryCall(obj: any, method: string, ...args: unknown[]): unknown {
  try {
    if (obj && typeof obj[method] === 'function') {
      return obj[method](...args);
    }
  } catch {
    /* not available / not in Telegram — ignore */
  }
  return undefined;
}

let didInit = false;

/** Detect whether we're inside a Telegram Mini App (never throws). */
export function inTelegram(): boolean {
  try {
    return Boolean(isTMA());
  } catch {
    return false;
  }
}

/**
 * Initialize the SDK, mount the pieces we need, bind theme + safe-area CSS
 * variables, and expand the viewport. Idempotent and safe to call anywhere.
 */
export function initTelegram(): TelegramEnv {
  if (typeof window === 'undefined') return { isTelegram: false, initDataRaw: null };

  const isTelegram = inTelegram();
  if (!isTelegram) return { isTelegram: false, initDataRaw: null };

  if (!didInit) {
    didInit = true;
    try {
      init();
    } catch {
      /* already initialized / unsupported */
    }

    // Mount mini app + theme params (sync where available) and bind theme vars.
    tryCall(miniApp, 'mountSync');
    tryCall(miniApp, 'mount');
    tryCall(themeParams, 'mountSync');
    tryCall(themeParams, 'mount');
    try {
      bindThemeParamsCssVars();
    } catch {
      /* ignore */
    }

    // Viewport mount is async in v3 — bind + expand once it resolves.
    try {
      const mounted = tryCall(viewport, 'mount');
      const finish = () => {
        try {
          bindViewportCssVars();
        } catch {
          /* ignore */
        }
        tryCall(viewport, 'expand');
        syncSafeArea();
      };
      if (mounted && typeof (mounted as Promise<unknown>).then === 'function') {
        (mounted as Promise<unknown>).then(finish).catch(finish);
      } else {
        finish();
      }
    } catch {
      /* ignore */
    }
  }

  let initDataRaw: string | null = null;
  try {
    initDataRaw = retrieveRawInitData() ?? null;
  } catch {
    initDataRaw = null;
  }

  return { isTelegram, initDataRaw };
}

/**
 * Read Telegram safe-area + content-safe-area insets and write them onto the
 * CSS variables that globals.css consumes (`env(safe-area-inset-*)` is broken
 * in Telegram, so we cannot rely on it).
 */
export function syncSafeArea(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  interface Insets {
    top: number;
    bottom: number;
    left: number;
    right: number;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const readInsets = (fn: any): Insets | null => {
    try {
      const v = typeof fn === 'function' ? fn() : undefined;
      if (v && typeof v.top === 'number') {
        return { top: v.top, bottom: v.bottom ?? 0, left: v.left ?? 0, right: v.right ?? 0 };
      }
    } catch {
      /* ignore */
    }
    return null;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vp = viewport as any;
  const safe = readInsets(vp?.safeAreaInsets) ?? readInsets(vp?.safeAreaInset);
  const content =
    readInsets(vp?.contentSafeAreaInsets) ?? readInsets(vp?.contentSafeAreaInset);

  const apply = (prefix: string, i: Insets) => {
    root.style.setProperty(`${prefix}-top`, `${i.top}px`);
    root.style.setProperty(`${prefix}-bottom`, `${i.bottom}px`);
    root.style.setProperty(`${prefix}-left`, `${i.left}px`);
    root.style.setProperty(`${prefix}-right`, `${i.right}px`);
  };

  if (safe) apply('--tg-safe-area-inset', safe);
  if (content) apply('--tg-content-safe-area-inset', content);
}

/** Fresh launch params (initData expires ~5 min — call right before use). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getLaunchParams(): any | null {
  try {
    return retrieveLaunchParams();
  } catch {
    return null;
  }
}

/** Fresh raw initData string for backend HMAC verification. */
export function getRawInitData(): string | null {
  try {
    return retrieveRawInitData() ?? null;
  } catch {
    return null;
  }
}

/**
 * Open an external (non-Telegram) URL in the system browser. Inside Telegram this
 * uses the SDK's `openLink` (the WebView blocks third-party redirects/popups, so
 * the Halliday card+KYC checkout must escape to the system browser); outside
 * Telegram (local `npm run dev` in a plain browser) it falls back to `window.open`.
 *
 * Feature-detected + try/catch in the same defensive style as the rest of the file,
 * so it never throws regardless of the SDK minor-version surface.
 */
export function openLink(url: string): void {
  if (inTelegram()) {
    // `tmaOpenLink` is a function with an `.isAvailable()` guard in v3; tryCall
    // swallows both the missing-method and not-supported cases.
    if (tryCall(tmaOpenLink, 'isAvailable') !== false) {
      try {
        tmaOpenLink(url);
        return;
      } catch {
        /* fall through to window.open */
      }
    }
  }
  if (typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener');
  }
}

/**
 * Open a `t.me` / Telegram-internal deep link (e.g. a `returnTo` back into the
 * mini-app). Uses the SDK's `openTelegramLink` in Telegram; degrades to a plain
 * `openLink` / `window.open` elsewhere.
 */
export function openTelegramLink(url: string): void {
  if (inTelegram()) {
    if (tryCall(tmaOpenTelegramLink, 'isAvailable') !== false) {
      try {
        tmaOpenTelegramLink(url);
        return;
      } catch {
        /* fall through */
      }
    }
  }
  openLink(url);
}

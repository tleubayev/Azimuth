import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the Telegram SDK wrapper so importing the Halliday helper doesn't pull in
// `@telegram-apps/sdk-react` (and so we can assert openExternal delegates to it).
// `vi.mock` is hoisted above this line, so the mock fn must be created via
// `vi.hoisted` (a bare `const openLink = vi.fn()` would be in the TDZ when the
// hoisted factory runs → "Cannot access 'openLink' before initialization").
const { openLink } = vi.hoisted(() => ({ openLink: vi.fn() }));
vi.mock('@/lib/telegram/init', () => ({ openLink }));

import {
  HALLIDAY_USDC_ETHEREUM,
  buildHostedCheckoutUrl,
  openExternal,
} from '@/lib/funding/halliday';
import { USDC } from '@/lib/config/chains';

const ADDRESS = '0x1111111111111111111111111111111111111111';

const ENV_KEYS = [
  'NEXT_PUBLIC_ONRAMP_CHECKOUT_URL',
  'NEXT_PUBLIC_APP_URL',
] as const;

const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.clearAllMocks();
});

describe('HALLIDAY_USDC_ETHEREUM', () => {
  it('is the canonical USDC-on-Ethereum output keyed to the repo USDC address', () => {
    expect(HALLIDAY_USDC_ETHEREUM).toBe(`ethereum:${USDC.ethereum}`);
  });
});

describe('buildHostedCheckoutUrl', () => {
  it('targets the configured checkout origin with destination, chain and asset', () => {
    process.env.NEXT_PUBLIC_ONRAMP_CHECKOUT_URL = 'https://example.test/onramp/checkout';
    delete process.env.NEXT_PUBLIC_APP_URL;

    const url = new URL(buildHostedCheckoutUrl({ address: ADDRESS }));
    expect(url.origin + url.pathname).toBe('https://example.test/onramp/checkout');
    expect(url.searchParams.get('destination')).toBe(ADDRESS);
    expect(url.searchParams.get('chain')).toBe('ethereum');
    expect(url.searchParams.get('asset')).toBe('USDC');
    // No NEXT_PUBLIC_APP_URL set → no returnTo.
    expect(url.searchParams.get('returnTo')).toBeNull();
    // The publishable key is NEVER placed in the query string.
    expect(url.search).not.toContain('pk_');
    expect(url.searchParams.has('apiKey')).toBe(false);
  });

  it('includes a returnTo deep link back into the mini-app when NEXT_PUBLIC_APP_URL is set', () => {
    process.env.NEXT_PUBLIC_ONRAMP_CHECKOUT_URL = 'https://example.test/onramp/checkout';
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.test';

    const url = new URL(buildHostedCheckoutUrl({ address: ADDRESS }));
    expect(url.searchParams.get('returnTo')).toBe('https://app.test');
  });

  it('falls back to the compasslabs.ai hosted checkout when no override is set', () => {
    delete process.env.NEXT_PUBLIC_ONRAMP_CHECKOUT_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;

    const url = new URL(buildHostedCheckoutUrl({ address: ADDRESS }));
    expect(url.origin + url.pathname).toBe('https://compasslabs.ai/onramp/checkout');
    expect(url.searchParams.get('destination')).toBe(ADDRESS);
  });
});

describe('openExternal', () => {
  it('delegates to the Telegram openLink wrapper', () => {
    openExternal('https://example.test/onramp/checkout');
    expect(openLink).toHaveBeenCalledWith('https://example.test/onramp/checkout');
  });
});

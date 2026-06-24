import { describe, it, expect, vi } from 'vitest';
import { resolveAccessToken } from '../accessToken';

describe('resolveAccessToken', () => {
  it('returns a freshly fetched token, ignoring the cached value', async () => {
    const getAccessToken = vi.fn().mockResolvedValue('fresh-access-token');

    const token = await resolveAccessToken(getAccessToken, 'stale-cached');

    expect(token).toBe('fresh-access-token');
  });

  it('returns the fresh token even when the cached snapshot is null (cold reopen)', async () => {
    // The reopen case: the Mini App was relaunched and no token is cached yet,
    // but getAccessToken() auto-refreshes and mints a fresh one. We must use it,
    // not throw "Not authenticated".
    const getAccessToken = vi.fn().mockResolvedValue('fresh-access-token');

    const token = await resolveAccessToken(getAccessToken, null);

    expect(token).toBe('fresh-access-token');
  });

  it('falls back to the cached token when getAccessToken returns null', async () => {
    const getAccessToken = vi.fn().mockResolvedValue(null);

    const token = await resolveAccessToken(getAccessToken, 'cached-token');

    expect(token).toBe('cached-token');
  });

  it('falls back to the cached token when getAccessToken throws', async () => {
    const getAccessToken = vi.fn().mockRejectedValue(new Error('network'));

    const token = await resolveAccessToken(getAccessToken, 'cached-token');

    expect(token).toBe('cached-token');
  });

  it('returns null when there is genuinely no token available', async () => {
    const getAccessToken = vi.fn().mockResolvedValue(null);

    const token = await resolveAccessToken(getAccessToken, null);

    expect(token).toBeNull();
  });
});

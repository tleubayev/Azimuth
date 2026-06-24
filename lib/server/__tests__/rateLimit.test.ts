import { describe, expect, it } from 'vitest';
import { rateLimit } from '@/lib/server/rateLimit';

// Unique keys per assertion so tests don't share bucket state (the limiter is a
// process-global map with no reset hook).
let n = 0;
const k = () => `test-key-${n++}`;

describe('rateLimit', () => {
  it('allows up to the limit then blocks within the window', () => {
    const key = k();
    for (let i = 0; i < 3; i++) {
      expect(rateLimit(key, 3, 60_000).ok).toBe(true);
    }
    const blocked = rateLimit(key, 3, 60_000);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('tracks distinct keys independently', () => {
    const a = k();
    const b = k();
    expect(rateLimit(a, 1, 60_000).ok).toBe(true);
    expect(rateLimit(a, 1, 60_000).ok).toBe(false);
    // A different key is unaffected by A's exhaustion.
    expect(rateLimit(b, 1, 60_000).ok).toBe(true);
  });
});

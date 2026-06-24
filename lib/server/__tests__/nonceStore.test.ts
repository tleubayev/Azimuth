import { beforeEach, describe, expect, it } from 'vitest';
import { consume, issue, __clearNonceStoreForTests } from '@/lib/server/nonceStore';

// Deterministic secret so the HMAC is stable across the test run.
process.env.NONCE_SECRET = 'test-nonce-secret';

describe('stateless nonce store', () => {
  beforeEach(() => __clearNonceStoreForTests());

  it('accepts a freshly issued nonce exactly once', () => {
    const n = issue();
    expect(consume(n)).toBe(true);
    expect(consume(n)).toBe(false); // single-use (same instance)
  });

  it('issues unique tokens', () => {
    expect(issue()).not.toBe(issue());
  });

  it('rejects a structurally invalid token', () => {
    expect(consume('not-a-token')).toBe(false);
    expect(consume('a.b')).toBe(false); // wrong part count
    expect(consume('')).toBe(false);
  });

  it('rejects a token with a tampered signature', () => {
    const n = issue();
    const parts = n.split('.');
    // Flip the last hex char of the signature.
    const sig = parts[2];
    const tampered = `${parts[0]}.${parts[1]}.${sig.slice(0, -1)}${sig.endsWith('a') ? 'b' : 'a'}`;
    expect(consume(tampered)).toBe(false);
  });

  it('rejects an expired token even with a valid signature shape', () => {
    // Tamper the expiry to the past: the signature no longer matches the
    // payload, so it must be rejected (integrity protects expiry too).
    const n = issue();
    const [rnd, , sig] = n.split('.');
    const expired = `${rnd}.1.${sig}`;
    expect(consume(expired)).toBe(false);
  });
});

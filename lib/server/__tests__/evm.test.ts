import { afterEach, describe, expect, it, vi } from 'vitest';
import { isSupportedEvmChain, publicClientForChain } from '@/lib/server/evm';

describe('isSupportedEvmChain', () => {
  it('accepts the withdraw-source chains (Ethereum + Arbitrum)', () => {
    expect(isSupportedEvmChain(1)).toBe(true); // Ethereum (tokenized)
    expect(isSupportedEvmChain(42161)).toBe(true); // Arbitrum (perps)
    expect(isSupportedEvmChain(8453)).toBe(false); // Base — not a withdraw source
    expect(isSupportedEvmChain(0)).toBe(false);
  });
});

describe('publicClientForChain', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('builds clients for the supported chains', () => {
    expect(publicClientForChain(1).chain?.id).toBe(1);
    expect(publicClientForChain(42161).chain?.id).toBe(42161);
  });

  it('throws on any unsupported chain id', () => {
    expect(() => publicClientForChain(8453)).toThrow(/unsupported/i);
    expect(() => publicClientForChain(12345)).toThrow(/unsupported/i);
  });

  it('prefers the configured RPC URL when present', () => {
    vi.stubEnv('ETHEREUM_MAINNET_RPC_URL', 'https://eth.example/rpc');
    vi.stubEnv('ARBITRUM_MAINNET_RPC_URL', 'https://arb.example/rpc');
    expect((publicClientForChain(1).transport as { url?: string }).url).toBe('https://eth.example/rpc');
    expect((publicClientForChain(42161).transport as { url?: string }).url).toBe('https://arb.example/rpc');
  });

  it('falls back to a default RPC when the env var is unset', () => {
    vi.stubEnv('ARBITRUM_MAINNET_RPC_URL', '');
    const client = publicClientForChain(42161);
    // viem fills in the chain's built-in default public RPC.
    expect((client.transport as { url?: string }).url).toBeTruthy();
  });
});

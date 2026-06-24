import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeFunctionData, erc20Abi, parseUnits } from 'viem';
import { depositToProduct, depositableAmount } from '@/lib/deposit/deposit';
import { FUNDING_TARGETS, HL_BRIDGE, USDC } from '@/lib/config/chains';

const transfer = (to: string, raw: bigint) =>
  encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [to as `0x${string}`, raw] });

function mockFetch(routes: (url: string, init?: RequestInit) => unknown) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => ({
    ok: true,
    json: async () => routes(url, init),
  })));
}

afterEach(() => vi.unstubAllGlobals());

describe('depositableAmount', () => {
  const perps = FUNDING_TARGETS.perps; // deposit floor $10, no upper cap (bridge min $15)
  const tok = FUNDING_TARGETS.tokenized; // min 25, no cap

  it('deposits the full perps balance above the $10 floor (no upper cap), floored to 2dp', () => {
    expect(depositableAmount(perps, 50)).toBe('50.00'); // no cap — full balance
    expect(depositableAmount(perps, 20.567)).toBe('20.56'); // floored
    expect(depositableAmount(perps, 10)).toBe('10.00');
    expect(depositableAmount(perps, 9.99)).toBeNull(); // below $10 floor
  });

  it('tokenized deposits any positive balance (floored)', () => {
    expect(depositableAmount(tok, 100)).toBe('100.00');
    expect(depositableAmount(tok, 30.999)).toBe('30.99');
    expect(depositableAmount(tok, 0.004)).toBeNull(); // below dust floor
  });
});

describe('depositToProduct — perps', () => {
  it('prepares via the deposit endpoint and transfers USDC to the HL bridge on Arbitrum', async () => {
    const owner = '0x1111111111111111111111111111111111111111';
    mockFetch((url) => {
      if (url.includes('global-markets-perps/deposit')) return { amountRaw: 12_000_000, destination: owner };
      throw new Error(`unexpected ${url}`);
    });
    const sendTransaction = vi.fn().mockResolvedValue('0xperpshash');

    const tx = await depositToProduct({
      targetKey: 'perps',
      owner,
      amountUsdc: '12',
      adapter: { address: owner, sendTransaction },
    });

    expect(tx).toBe('0xperpshash');
    expect(sendTransaction).toHaveBeenCalledWith({
      to: USDC.arbitrum,
      data: transfer(HL_BRIDGE, 12_000_000n),
      chainId: 42161,
    });
  });
});

describe('depositToProduct — tokenized', () => {
  it('transfers USDC to the existing Safe on Ethereum', async () => {
    const owner = '0x2222222222222222222222222222222222222222';
    const safe = '0x3333333333333333333333333333333333333333';
    mockFetch((url) => {
      if (url.includes('tokenized-assets/check')) return { account_address: safe, is_deployed: true };
      throw new Error(`unexpected ${url}`);
    });
    const sendTransaction = vi.fn().mockResolvedValue('0xtokhash');

    await depositToProduct({
      targetKey: 'tokenized',
      owner,
      amountUsdc: '25',
      adapter: { address: owner, sendTransaction },
    });

    expect(sendTransaction).toHaveBeenCalledWith({
      to: USDC.ethereum,
      data: transfer(safe, parseUnits('25', 6)),
      chainId: 1,
    });
  });

  it('creates the Safe first when not deployed', async () => {
    const owner = '0x4444444444444444444444444444444444444444';
    const safe = '0x5555555555555555555555555555555555555555';
    const calls: string[] = [];
    mockFetch((url) => {
      calls.push(url);
      if (url.includes('tokenized-assets/check')) return { account_address: safe, is_deployed: false };
      if (url.includes('tokenized-assets/create-account')) return { account_address: safe, already_exists: false };
      throw new Error(`unexpected ${url}`);
    });
    const sendTransaction = vi.fn().mockResolvedValue('0xtok2');

    await depositToProduct({
      targetKey: 'tokenized',
      owner,
      amountUsdc: '40',
      adapter: { address: owner, sendTransaction },
    });

    expect(calls.some((u) => u.includes('create-account'))).toBe(true);
    expect(sendTransaction).toHaveBeenCalledWith({
      to: USDC.ethereum,
      data: transfer(safe, parseUnits('40', 6)),
      chainId: 1,
    });
  });
});

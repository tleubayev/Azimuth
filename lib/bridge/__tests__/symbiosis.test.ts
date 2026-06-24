import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SymbiosisClient } from '@/lib/bridge/symbiosis';
import { buildSymbiosisQuoteParams, toBaseUnits } from '@/lib/bridge/quote-helper';
import { FUNDING_TARGETS, USDC, USDC_DECIMALS, CHAIN_IDS, TON_USDT } from '@/lib/config/chains';
import type { BridgeQuoteRequest } from '@/lib/bridge/types';

/** Build a Response-like object for a mocked fetch. */
function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  const status = init.status ?? 200;
  const ok = init.ok ?? (status >= 200 && status < 300);
  return {
    ok,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const SAMPLE_QUOTE_RESPONSE = {
  tokenAmountOut: {
    amount: '11.95',
    address: USDC.arbitrum,
    chainId: CHAIN_IDS.arbitrum,
    symbol: 'USDC',
    decimals: 6,
  },
  fee: { amount: '0.05', address: USDC.arbitrum, chainId: CHAIN_IDS.arbitrum, symbol: 'USDC' },
  route: [{ provider: 'symbiosis' }],
  estimatedTime: 27,
  tx: {
    validUntil: 1999999999,
    messages: [
      {
        address: 'EQjettonWalletAddress',
        amount: '100000000',
        payload: 'te6ccgEBAQEAAg==',
      },
    ],
  },
};

describe('SymbiosisClient.quote', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse(SAMPLE_QUOTE_RESPONSE));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('posts the right body with revertableAddress=from and injected partnerId, mapped to BridgeQuoteResponse', async () => {
    const client = new SymbiosisClient({
      baseUrl: 'https://api.test.symbiosis/crosschain',
      partnerId: 'compass-mini-app',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const result = await client.quote({
      tokenAmountIn: {
        amount: '12000000',
        address: TON_USDT.address,
        chainId: CHAIN_IDS.ton,
        decimals: TON_USDT.decimals,
        attributes: { ton: TON_USDT.tonAddress },
      },
      tokenOut: { address: USDC.arbitrum, chainId: CHAIN_IDS.arbitrum, decimals: USDC_DECIMALS },
      from: 'EQuserTonAddress',
      to: '0x1111111111111111111111111111111111111111',
      slippageBps: 100,
    });

    // --- request assertions ---
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test.symbiosis/crosschain/v2/quote');
    expect(init.method).toBe('POST');

    const sentBody = JSON.parse(init.body as string);
    expect(sentBody.tokenAmountIn).toEqual({
      amount: '12000000',
      address: TON_USDT.address,
      chainId: 85918,
      decimals: TON_USDT.decimals,
      attributes: { ton: TON_USDT.tonAddress },
    });
    expect(sentBody.tokenOut).toEqual({
      address: USDC.arbitrum,
      chainId: CHAIN_IDS.arbitrum,
      decimals: USDC_DECIMALS,
    });
    expect(sentBody.from).toBe('EQuserTonAddress');
    expect(sentBody.to).toBe('0x1111111111111111111111111111111111111111');
    expect(sentBody.slippage).toBe(100);
    // revertableAddress ALWAYS equals `from`.
    expect(sentBody.revertableAddress).toBe('EQuserTonAddress');
    // partnerId injected from the client config.
    expect(sentBody.partnerId).toBe('compass-mini-app');

    // --- response mapping assertions ---
    expect(result.amountOut).toEqual({
      amount: '11.95',
      token: USDC.arbitrum,
      chainId: CHAIN_IDS.arbitrum,
      symbol: 'USDC',
      decimals: 6,
    });
    expect(result.fee).toEqual({
      amount: '0.05',
      token: USDC.arbitrum,
      chainId: CHAIN_IDS.arbitrum,
      symbol: 'USDC',
    });
    expect(result.estimatedTimeSeconds).toBe(27);
    expect(result.route).toEqual([{ provider: 'symbiosis' }]);

    // TON Connect message extracted from `tx`.
    expect(result.tonTransaction).not.toBeNull();
    expect(result.tonTransaction?.validUntil).toBe(1999999999);
    expect(result.tonTransaction?.messages).toEqual([
      { address: 'EQjettonWalletAddress', amount: '100000000', payload: 'te6ccgEBAQEAAg==' },
    ]);
  });

  it('omits partnerId from the body when none is configured', async () => {
    const client = new SymbiosisClient({
      baseUrl: 'https://api.test.symbiosis/crosschain',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await client.quote({
      tokenAmountIn: {
        amount: '5000000',
        address: TON_USDT.address,
        chainId: CHAIN_IDS.ton,
        decimals: TON_USDT.decimals,
        attributes: { ton: TON_USDT.tonAddress },
      },
      tokenOut: { address: USDC.ethereum, chainId: CHAIN_IDS.ethereum, decimals: USDC_DECIMALS },
      from: 'EQuserTonAddress',
      to: '0x2222222222222222222222222222222222222222',
      slippageBps: 50,
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const sentBody = JSON.parse(init.body as string);
    expect('partnerId' in sentBody).toBe(false);
    expect(sentBody.revertableAddress).toBe('EQuserTonAddress');
  });

  it('throws BridgeError on a non-2xx response', async () => {
    const errorFetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ message: 'bad pair' }, { status: 400 }));
    const client = new SymbiosisClient({
      fetchImpl: errorFetch as unknown as typeof fetch,
    });

    await expect(
      client.quote({
        tokenAmountIn: {
          amount: '1000000',
          address: TON_USDT.address,
          chainId: CHAIN_IDS.ton,
          decimals: TON_USDT.decimals,
          attributes: { ton: TON_USDT.tonAddress },
        },
        tokenOut: { address: USDC.arbitrum, chainId: CHAIN_IDS.arbitrum, decimals: USDC_DECIMALS },
        from: 'EQx',
        to: '0x3333333333333333333333333333333333333333',
        slippageBps: 100,
      }),
    ).rejects.toMatchObject({ name: 'BridgeError', status: 400 });
  });
});

describe('buildSymbiosisQuoteParams (target resolution)', () => {
  const base: Omit<BridgeQuoteRequest, 'targetKey'> = {
    amount: '20',
    fromTon: 'EQuserTonAddress',
    toEvm: '0x4444444444444444444444444444444444444444',
    slippageBps: 100,
  };

  it("maps targetKey 'perps' -> Arbitrum USDC", () => {
    const params = buildSymbiosisQuoteParams({ ...base, targetKey: 'perps' });
    expect(params.tokenOut.chainId).toBe(CHAIN_IDS.arbitrum);
    expect(params.tokenOut.address).toBe(USDC.arbitrum);
    expect(params.tokenOut.address).toBe(FUNDING_TARGETS.perps.token);
    expect(params.tokenOut.decimals).toBe(USDC_DECIMALS);
    // Source leg is USD₮ on TON: numeric chain id, base-units amount ("20" → 6dp),
    // mapped address + the jetton master in attributes.ton.
    expect(params.tokenAmountIn.chainId).toBe(85918);
    expect(params.tokenAmountIn.amount).toBe('20000000');
    expect(params.tokenAmountIn.address).toBe(TON_USDT.address);
    expect(params.tokenAmountIn.decimals).toBe(TON_USDT.decimals);
    expect(params.tokenAmountIn.attributes).toEqual({ ton: TON_USDT.tonAddress });
    expect(params.from).toBe('EQuserTonAddress');
    expect(params.to).toBe('0x4444444444444444444444444444444444444444');
  });

  it("maps targetKey 'tokenized' -> Ethereum USDC", () => {
    const params = buildSymbiosisQuoteParams({ ...base, targetKey: 'tokenized' });
    expect(params.tokenOut.chainId).toBe(CHAIN_IDS.ethereum);
    expect(params.tokenOut.address).toBe(USDC.ethereum);
    expect(params.tokenOut.address).toBe(FUNDING_TARGETS.tokenized.token);
  });

  it('defaults slippage when not supplied', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { slippageBps: _drop, ...noSlippage } = base;
    const params = buildSymbiosisQuoteParams({ ...noSlippage, targetKey: 'perps' });
    expect(params.slippageBps).toBe(100);
  });
});

describe('toBaseUnits', () => {
  it('converts human decimals to base units (6dp)', () => {
    expect(toBaseUnits('20', 6)).toBe('20000000');
    expect(toBaseUnits('12.5', 6)).toBe('12500000');
    expect(toBaseUnits('0.5', 6)).toBe('500000');
    expect(toBaseUnits('0.000001', 6)).toBe('1');
    // Excess fractional precision is truncated to the token's decimals.
    expect(toBaseUnits('1.2345678', 6)).toBe('1234567');
  });
});

describe('SymbiosisClient.getTxStatus', () => {
  it('maps a raw status into a normalized BridgeStatusResponse', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ status: 'Pending', outHash: '0xdeadbeef' }),
      );
    const client = new SymbiosisClient({
      baseUrl: 'https://api.test.symbiosis/crosschain',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const res = await client.getTxStatus({ chainId: CHAIN_IDS.ton, txHash: '0xabc' });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('https://api.test.symbiosis/crosschain/v2/tx/85918/0xabc');
    expect(res.status).toBe('pending');
    expect(res.rawStatus).toBe('Pending');
    expect(res.destinationTxHash).toBe('0xdeadbeef');
    expect(res.txHash).toBe('0xabc');
    expect(res.chainId).toBe(CHAIN_IDS.ton);
  });
});

describe('SymbiosisClient.quote — EVM-origin (withdraw to TON)', () => {
  it('maps an EVM-side tx + top-level approveTo into result.evmTransaction', async () => {
    const EVM_RESPONSE = {
      tokenAmountOut: { amount: '11.9', address: TON_USDT.address, chainId: CHAIN_IDS.ton, symbol: 'USDT', decimals: 6 },
      approveTo: '0x5555555555555555555555555555555555555555',
      tx: { to: '0x6666666666666666666666666666666666666666', data: '0xabcdef', value: '0', chainId: CHAIN_IDS.ethereum },
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(EVM_RESPONSE));
    const client = new SymbiosisClient({ fetchImpl: fetchMock as unknown as typeof fetch });

    const result = await client.quote({
      tokenAmountIn: { amount: '11900000', address: USDC.ethereum, chainId: CHAIN_IDS.ethereum, decimals: USDC_DECIMALS },
      tokenOut: { address: TON_USDT.address, chainId: CHAIN_IDS.ton, decimals: TON_USDT.decimals },
      from: '0x7777777777777777777777777777777777777777',
      to: 'EQuserTonAddress',
      slippageBps: 100,
    });

    expect(result.tonTransaction).toBeNull();
    expect(result.evmTransaction).toEqual({
      to: '0x6666666666666666666666666666666666666666',
      data: '0xabcdef',
      value: '0',
      chainId: CHAIN_IDS.ethereum,
      approveTo: '0x5555555555555555555555555555555555555555',
    });
  });

  it('omits approveTo when absent (the hook falls back to tx.to as the spender)', async () => {
    const EVM_RESPONSE = {
      tx: { to: '0x8888888888888888888888888888888888888888', data: '0x01', chainId: CHAIN_IDS.arbitrum },
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(EVM_RESPONSE));
    const client = new SymbiosisClient({ fetchImpl: fetchMock as unknown as typeof fetch });

    const result = await client.quote({
      tokenAmountIn: { amount: '1000000', address: USDC.arbitrum, chainId: CHAIN_IDS.arbitrum, decimals: USDC_DECIMALS },
      tokenOut: { address: TON_USDT.address, chainId: CHAIN_IDS.ton, decimals: TON_USDT.decimals },
      from: '0x9999999999999999999999999999999999999999',
      to: 'EQx',
      slippageBps: 100,
    });

    expect(result.evmTransaction?.to).toBe('0x8888888888888888888888888888888888888888');
    expect(result.evmTransaction?.approveTo).toBeUndefined();
  });
});

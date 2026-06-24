'use client';

import { encodeFunctionData, erc20Abi, parseUnits } from 'viem';
import {
  FUNDING_TARGETS,
  HL_BRIDGE,
  USDC,
  USDC_DECIMALS,
  type FundingTarget,
  type FundingTargetKey,
} from '@/lib/config/chains';

/**
 * Moves USDC from the user's embedded EVM wallet INTO the product's trading
 * account — the second leg of "Add funds" (the bridge delivers USDC to the
 * wallet; this lands it where the widget can trade it).
 *
 * Both flows mirror the widgets-sdk source exactly (TraditionalInvestingWidget
 * `handleDeposit`, TokenizedAssetsWidget `DepositSheet`): the transaction's `to`
 * is the USDC token contract, and the destination is the ERC-20 transfer's
 * recipient argument (perps → Hyperliquid bridge; tokenized → the per-owner Safe).
 */

/** Minimal slice of the widgets-sdk WalletAdapter we need to send a tx. */
export interface DepositAdapter {
  address: string | null;
  sendTransaction?: (params: {
    to: string;
    data?: string;
    value?: string;
    chainId?: number;
  }) => Promise<string>;
}

function jsonHeaders(): HeadersInit {
  return { 'content-type': 'application/json' };
}

/** Read the wallet's human-readable USDC balance on a chain (0 on error). */
export async function getWalletUsdc(owner: string, chainName: string): Promise<number> {
  try {
    const res = await fetch(
      `/api/compass/token/balance?address=${owner}&chain=${chainName}&token=USDC`,
    );
    if (!res.ok) return 0;
    // `balance` is human-readable; `balanceRaw` is unreliable (always '0').
    const data = (await res.json()) as { balance?: string };
    return parseFloat(data.balance ?? '0') || 0;
  } catch {
    return 0;
  }
}

function transferData(to: string, rawAmount: bigint): string {
  return encodeFunctionData({
    abi: erc20Abi,
    functionName: 'transfer',
    args: [to as `0x${string}`, rawAmount],
  });
}

/**
 * Perps: ERC-20 transfer of USDC to the Hyperliquid Bridge2 on Arbitrum.
 * Hyperliquid's bridge monitor credits the sender's L1 account. No create-account.
 */
async function depositPerps(owner: string, amountUsdc: string, adapter: DepositAdapter): Promise<string> {
  if (!adapter.sendTransaction) throw new Error('Wallet cannot send transactions.');

  const res = await fetch('/api/compass/global-markets-perps/deposit', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ owner, amount: amountUsdc }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? 'Failed to prepare Hyperliquid deposit.');
  }
  const { amountRaw } = (await res.json()) as { amountRaw?: number | string };
  // Prefer the API's canonical raw amount; fall back to local scaling.
  const raw =
    amountRaw != null
      ? BigInt(typeof amountRaw === 'number' ? Math.round(amountRaw) : amountRaw)
      : parseUnits(amountUsdc, USDC_DECIMALS);

  return adapter.sendTransaction({
    to: USDC.arbitrum,
    data: transferData(HL_BRIDGE, raw),
    chainId: 42161,
  });
}

/**
 * Tokenized: ensure the per-owner Safe exists (idempotent, server-deployed +
 * gas-sponsored), then ERC-20 transfer USDC to it.
 */
async function depositTokenized(
  owner: string,
  amountUsdc: string,
  adapter: DepositAdapter,
  target: FundingTarget,
): Promise<string> {
  if (!adapter.sendTransaction) throw new Error('Wallet cannot send transactions.');
  const chain = target.chainName;

  // Check / predict the Safe (counterfactual address is known before deploy).
  const checkRes = await fetch(
    `/api/compass/tokenized-assets/check?owner=${owner}&chain=${chain}`,
  );
  if (!checkRes.ok) throw new Error('Failed to check your tokenized assets account.');
  const check = (await checkRes.json()) as {
    account_address?: string;
    accountAddress?: string;
    is_deployed?: boolean;
    isDeployed?: boolean;
  };
  let account = check.account_address ?? check.accountAddress;
  const isDeployed = check.is_deployed ?? check.isDeployed ?? false;

  // Create it if needed (broadcast server-side; no client tx). Requires
  // GAS_SPONSOR_PK + ETHEREUM_MAINNET_RPC_URL on the proxy.
  if (!isDeployed) {
    const createRes = await fetch('/api/compass/tokenized-assets/create-account', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ owner, chain }),
    });
    if (!createRes.ok) {
      const body = (await createRes.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? 'Failed to create your tokenized assets account.');
    }
    const created = (await createRes.json()) as {
      account_address?: string;
      accountAddress?: string;
    };
    account = created.account_address ?? created.accountAddress ?? account;
  }
  if (!account) throw new Error('No tokenized assets account address.');

  return adapter.sendTransaction({
    to: target.token,
    data: transferData(account, parseUnits(amountUsdc, USDC_DECIMALS)),
    chainId: target.chainId,
  });
}

/**
 * Deposit `amountUsdc` (human string) from the embedded wallet into the product
 * account for `targetKey`. Returns the deposit tx hash.
 */
export async function depositToProduct(args: {
  targetKey: FundingTargetKey;
  owner: string;
  amountUsdc: string;
  adapter: DepositAdapter;
}): Promise<string> {
  const target = FUNDING_TARGETS[args.targetKey];
  if (target.product === 'perps') {
    return depositPerps(args.owner, args.amountUsdc, args.adapter);
  }
  return depositTokenized(args.owner, args.amountUsdc, args.adapter, target);
}

/**
 * The amount to deposit given the wallet's available USDC, floored to 2dp.
 * There is no upper cap — the full available balance is depositable. Returns
 * null if the balance is below the product's usable minimum.
 */
export function depositableAmount(target: FundingTarget, walletUsdc: number): string | null {
  const floored = Math.floor(walletUsdc * 100) / 100;
  // Perps enforces its minUsd floor; tokenized just needs a positive amount.
  const floor = target.product === 'perps' ? target.minUsd : 0.01;
  if (floored < floor) return null;
  return floored.toFixed(2);
}

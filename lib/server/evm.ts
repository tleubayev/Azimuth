import { createPublicClient, http, type Chain } from 'viem';
import { arbitrum, mainnet } from 'viem/chains';

/**
 * Read-only, server-side viem public clients for the chains the withdraw-to-TON
 * bridge can leave from — Ethereum (the tokenized "Stocks & RWA" path) and
 * Arbitrum (perps). Used inside Node-runtime route handlers (e.g.
 * /api/evm/receipt) for light reads like transaction-receipt lookups, so the RPC
 * URL stays server-side. Reuses the Compass proxy's RPC envs; when unset, viem
 * falls back to the chain's built-in default public RPC (fine for a read this
 * light).
 *
 * Keep the supported set in sync with WITHDRAW_TO_TON_CHAIN_IDS
 * (lib/config/chains.ts) and the gate in lib/hooks/useWithdraw.ts.
 */

interface EvmChainConfig {
  chain: Chain;
  rpcEnv: string;
}

const SUPPORTED_CHAINS: Record<number, EvmChainConfig> = {
  [mainnet.id]: { chain: mainnet, rpcEnv: 'ETHEREUM_MAINNET_RPC_URL' },
  [arbitrum.id]: { chain: arbitrum, rpcEnv: 'ARBITRUM_MAINNET_RPC_URL' },
};

/** Whether `chainId` is a supported withdraw-source chain (Ethereum, Arbitrum). */
export function isSupportedEvmChain(chainId: number): boolean {
  return chainId in SUPPORTED_CHAINS;
}

/**
 * Build a read-only public client for `chainId`. Throws on any unsupported
 * chain. Prefers the configured RPC URL; falls back to viem's default public RPC
 * when the env var is unset.
 */
export function publicClientForChain(chainId: number) {
  const cfg = SUPPORTED_CHAINS[chainId];
  if (!cfg) {
    throw new Error(
      `Unsupported EVM chain id: ${chainId} (withdraw supports Ethereum + Arbitrum)`,
    );
  }
  const rpcUrl = process.env[cfg.rpcEnv];
  return createPublicClient({
    chain: cfg.chain,
    transport: http(rpcUrl && rpcUrl.length > 0 ? rpcUrl : undefined),
  });
}

'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { usePrivy, useWallets, useFundWallet, getAccessToken } from '@privy-io/react-auth';
import { mainnet, base, arbitrum, hyperEvm, arbitrumSepolia } from 'viem/chains';
import { defineChain, type Chain } from 'viem';

/**
 * Hyperliquid L1 "Exchange" virtual chain — used in EIP-712 domains for
 * phantom agent signing (orders, cancels).  Not a real network; only
 * needed so Privy allows signTypedData with this chainId.
 */
export const hyperliquidL1 = defineChain({
  id: 1337,
  name: 'Hyperliquid L1',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://api.hyperliquid.xyz/evm'] } },
});

import type { WalletAdapter, TypedDataToSign, FundWalletParams, SendTransactionParams } from '@compass-labs/widgets';
import { resolveAccessToken } from '../auth/accessToken';

/**
 * Server-side signing endpoints (Privy delegated authorization key). The embedded
 * wallet is delegated to the app's key quorum once (see useDelegateWallet), then
 * the server signs every action — so the user is NEVER prompted to sign.
 *
 * The Privy access token proves to the route that the caller owns `address`, so a
 * delegated wallet can't be driven by someone else's session. (We use the access
 * token, not the identity token: the identity token is null in the Telegram
 * WebView unless the dashboard issues it — see resolveAccessToken.)
 */
async function serverSignTypedData(address: string, data: TypedDataToSign, accessToken: string): Promise<string> {
  const res = await fetch('/api/privy/sign-typed-data', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address, typedData: data, accessToken }),
  });
  const body = (await res.json().catch(() => ({}))) as { signature?: string; error?: string };
  if (!res.ok || !body.signature) throw new Error(body.error ?? 'Server signing failed');
  return body.signature;
}

async function serverSendTransaction(address: string, params: SendTransactionParams, accessToken: string): Promise<string> {
  const res = await fetch('/api/privy/send-transaction', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      address,
      to: params.to,
      data: params.data,
      value: params.value,
      gas: params.gas,
      chainId: params.chainId,
      accessToken,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { hash?: string; error?: string };
  if (!res.ok || !body.hash) throw new Error(body.error ?? 'Server transaction failed');
  return body.hash;
}

/**
 * Whether a wallet is a Privy EMBEDDED wallet (vs an injected external wallet).
 * Embedded wallets sign server-side (no prompt); external wallets sign via the
 * provider (which prompts). Privy reports `walletClientType: 'privy'` today; we
 * match any `privy*` prefix so a future embedded client type (e.g. 'privy-v2')
 * is never misclassified as external and routed to the prompting path.
 */
function isEmbedded(wallet: { walletClientType?: string } | null | undefined): boolean {
  return !!wallet?.walletClientType && wallet.walletClientType.startsWith('privy');
}

const CHAIN_MAP: Record<number, Chain> = {
  1: mainnet,
  8453: base,
  42161: arbitrum,
  999: hyperEvm,
  1337: hyperliquidL1,
  // Hyperliquid's user-signed actions (userSetAbstraction) sign over EIP-712
  // domain chainId 421614. External wallets enforce active-chain == domain
  // chainId for eth_signTypedData_v4, and 421614 is the real Arbitrum Sepolia
  // network — so we must switch to the actual Arbitrum Sepolia (its own RPC),
  // not a virtual chain sharing Hyperliquid's RPC (which MetaMask rejects as a
  // duplicate of the 1337 network).
  421614: arbitrumSepolia,
};

/**
 * Switch chain via raw provider RPC to avoid Privy re-detection disconnect.
 * Falls back to wallet_addEthereumChain if the chain isn't added yet (4902).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function switchChainViaProvider(provider: any, chainId: number): Promise<void> {
  const currentHex = await provider.request({ method: 'eth_chainId' }) as string;
  const current = parseInt(currentHex, 16);
  if (current === chainId) return;

  const targetHex = `0x${chainId.toString(16)}`;
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: targetHex }] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    if (err?.code === 4902) {
      const chainDef = CHAIN_MAP[chainId];
      if (!chainDef) throw new Error(`Chain ${chainId} is not supported`);
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [{ chainId: targetHex, chainName: chainDef.name, rpcUrls: [chainDef.rpcUrls.default.http[0]], nativeCurrency: chainDef.nativeCurrency }],
      });
      // Per EIP-3085 a wallet is NOT required to auto-select a freshly added
      // chain, so explicitly switch — otherwise the active chain can stay wrong
      // and the next sign/tx targets the previous network. Verify after.
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: targetHex }] });
      const nowHex = (await provider.request({ method: 'eth_chainId' })) as string;
      if (parseInt(nowHex, 16) !== chainId) {
        throw new Error(`Failed to switch to chain ${chainId} after adding it`);
      }
    } else {
      throw err;
    }
  }
}

/**
 * Creates a WalletAdapter from Privy's wallet hooks.
 * This bridges Privy authentication to the widgets-sdk's wallet interface.
 */
export function usePrivyWalletAdapter(): WalletAdapter {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { wallets } = useWallets();
  const { fundWallet: privyFundWallet } = useFundWallet();

  // Cache the last access token we resolved so a transient getAccessToken()
  // failure during a sign still has a recent token to fall back to.
  const accessTokenRef = useRef<string | null>(null);

  // Find external wallet (MetaMask, Coinbase, etc.) and embedded Privy wallet
  const externalWallet = wallets.find(
    (wallet) => !isEmbedded(wallet) && wallet.type === 'ethereum'
  );
  const embeddedWallet = wallets.find(
    (wallet) => isEmbedded(wallet) && wallet.type === 'ethereum'
  );

  // Determine if the user signed up via email/social or wallet.
  // Privy always creates an embedded wallet, but MetaMask can be auto-detected
  // in the wallets array even for email users. We need to pick the RIGHT wallet.
  //
  // Strategy: if the user's Privy account has an email/phone/social linked,
  // they're an email user → use embedded wallet. MetaMask being injected in the
  // browser doesn't mean they want to use it.
  // Only use external wallet if the user has NO email/social accounts (pure wallet login).
  const linkedAccountTypes = new Set(user?.linkedAccounts?.map((a) => a.type) ?? []);
  const isEmailOrSocialUser = linkedAccountTypes.has('email') ||
    linkedAccountTypes.has('phone') ||
    linkedAccountTypes.has('google_oauth') ||
    linkedAccountTypes.has('apple_oauth') ||
    linkedAccountTypes.has('twitter_oauth') ||
    linkedAccountTypes.has('discord_oauth') ||
    linkedAccountTypes.has('github_oauth') ||
    linkedAccountTypes.has('farcaster') ||
    linkedAccountTypes.has('telegram') ||
    // TON-keyed identity (NEXT_PUBLIC_ENABLE_TON_KEYED_IDENTITY) logs in via a
    // backend-minted JWT → a 'custom_auth' linked account, NOT 'telegram'. Treat
    // it as an embedded-wallet user so signing stays on the server (no prompt).
    linkedAccountTypes.has('custom_auth');

  // Track whether we've ever seen an external wallet for this session (wallet-login users only).
  const hadExternalWalletRef = useRef(false);
  if (!isEmailOrSocialUser && externalWallet) {
    hadExternalWalletRef.current = true;
  }
  if (!authenticated) {
    hadExternalWalletRef.current = false;
  }

  // hasExternalWallet = user connected with a real wallet (not email/social).
  const hasExternalWallet = !isEmailOrSocialUser && (hadExternalWalletRef.current || !!externalWallet);

  // Email/social users (incl. Telegram) → always embedded wallet, ignore MetaMask.
  // Wallet-login users → external wallet only, or undefined if temporarily
  // unavailable. We must NOT fall back to the embedded wallet here: it is a
  // different address, so signing/sending through it during detection lag would
  // act on the wrong account.
  const activeWallet = isEmailOrSocialUser
    ? (embeddedWallet ?? undefined)
    : (externalWallet ?? undefined);

  // Get the wallet's current chain ID
  const walletChainId = activeWallet?.chainId ? parseInt(activeWallet.chainId.split(':')[1], 10) : undefined;

  // Cache the last known address so it survives brief Privy re-detection during
  // chain switches.
  const lastAddressRef = useRef<`0x${string}` | null>(null);
  if (authenticated && activeWallet?.address) {
    lastAddressRef.current = activeWallet.address as `0x${string}`;
  }
  if (!authenticated) {
    lastAddressRef.current = null;
  }
  const stableAddress = (authenticated && activeWallet?.address)
    ? (activeWallet.address as `0x${string}`)
    : lastAddressRef.current;

  // Stabilize wallet chain ID across re-detection gaps.
  const lastChainIdRef = useRef<number | undefined>(undefined);
  if (walletChainId !== undefined) {
    lastChainIdRef.current = walletChainId;
  }
  if (!authenticated) {
    lastChainIdRef.current = undefined;
  }
  const stableChainId = walletChainId ?? lastChainIdRef.current;

  // Cache the wallet object and provider so callbacks survive Privy re-detection.
  const walletRef = useRef(activeWallet);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const providerRef = useRef<any>(null);
  if (activeWallet) {
    walletRef.current = activeWallet;
  }
  if (!authenticated) {
    walletRef.current = undefined;
    providerRef.current = null;
  }

  // Cache provider in useEffect to avoid async side effects during render.
  useEffect(() => {
    if (!activeWallet) return;
    let cancelled = false;
    activeWallet.getEthereumProvider().then(p => {
      if (!cancelled) providerRef.current = p;
    });
    return () => { cancelled = true; };
  }, [activeWallet]);

  const signTypedData = useCallback(async (data: TypedDataToSign): Promise<string> => {
    const wallet = activeWallet ?? walletRef.current;
    if (!wallet) {
      throw new Error('No wallet connected');
    }

    const isEmbeddedWallet = isEmbedded(wallet);
    // Embedded wallet → server-side signing via Privy (the user is NOT prompted).
    // Gate on the wallet TYPE alone (symmetric with handleSendTransaction) and
    // fall back to the cached address: if Privy momentarily reports an undefined
    // `wallet.address` during re-detection, an embedded wallet must NEVER fall
    // through to the prompting provider path below.
    if (isEmbeddedWallet) {
      const address = wallet.address ?? lastAddressRef.current;
      if (!address) throw new Error('Wallet address unavailable — please try again.');
      // Resolve a FRESH access token at call time (auto-refreshing; reliable in
      // the Telegram WebView where the identity token is null — see resolveAccessToken).
      const accessToken = await resolveAccessToken(getAccessToken, accessTokenRef.current);
      if (!accessToken) throw new Error('Not authenticated — please sign in again.');
      accessTokenRef.current = accessToken;
      return serverSignTypedData(address, data, accessToken);
    }

    // External wallet (dev / non-Telegram) → sign in the wallet's provider.
    const provider = providerRef.current ?? await wallet.getEthereumProvider();
    const domainChainId = data.domain.chainId != null ? Number(data.domain.chainId) : undefined;

    // For external wallets (MetaMask): switch chains via raw provider to avoid
    // Privy re-detection disconnect. Embedded wallets don't enforce domain
    // chainId matching — skip switching.
    if (!isEmbeddedWallet && domainChainId != null) {
      await switchChainViaProvider(provider, domainChainId);
    }

    // Build EIP712Domain fields dynamically based on which domain fields are present
    const domainFields: { name: string; type: string }[] = [];
    if (data.domain.name !== undefined) domainFields.push({ name: 'name', type: 'string' });
    if (data.domain.version !== undefined) domainFields.push({ name: 'version', type: 'string' });
    if (data.domain.chainId !== undefined) domainFields.push({ name: 'chainId', type: 'uint256' });
    if (data.domain.verifyingContract !== undefined) domainFields.push({ name: 'verifyingContract', type: 'address' });

    // The Speakeasy SDK camelCases EIP-712 type names when parsing the API
    // response. MetaMask needs the original PascalCase to match `primaryType`.
    const types: Record<string, unknown> = { EIP712Domain: domainFields };
    for (const [key, value] of Object.entries(data.types as Record<string, unknown>)) {
      if (key === 'EIP712Domain' || key === 'eip712Domain') continue;
      const pascalKey = key.charAt(0).toUpperCase() + key.slice(1);
      types[pascalKey] = value;
    }

    const payload = JSON.stringify({
      types,
      primaryType: data.primaryType,
      domain: data.domain,
      message: data.message,
    });

    const signature = await provider.request({
      method: 'eth_signTypedData_v4',
      params: [wallet.address, payload],
    });

    return signature as string;
  }, [activeWallet]);

  const switchChain = useCallback(async (chainId: number): Promise<void> => {
    const wallet = activeWallet ?? walletRef.current;
    if (!wallet) {
      throw new Error('No wallet connected');
    }

    // Embedded wallets: use Privy's switchChain (no re-detection issue)
    if (isEmbedded(wallet)) {
      await wallet.switchChain(chainId);
      return;
    }

    // External wallets: raw provider call to avoid Privy re-detection disconnect
    const provider = providerRef.current ?? await wallet.getEthereumProvider();
    await switchChainViaProvider(provider, chainId);
  }, [activeWallet]);

  const handleFundWallet = useCallback(async (params: FundWalletParams) => {
    const viemChain = CHAIN_MAP[params.chainId];
    if (!viemChain) {
      throw new Error(`Cannot fund: unsupported chainId ${params.chainId}`);
    }
    await privyFundWallet({
      address: params.address,
      options: {
        chain: viemChain,
        asset: params.asset as 'USDC' | 'native-currency',
        amount: params.amount,
      },
    });
  }, [privyFundWallet]);

  const handleSendTransaction = useCallback(async (params: SendTransactionParams): Promise<string> => {
    const wallet = activeWallet ?? walletRef.current;
    if (!wallet) throw new Error('No wallet connected');

    // For external wallets, send via the wallet's provider directly.
    if (!isEmbedded(wallet)) {
      const provider = providerRef.current ?? await wallet.getEthereumProvider();
      if (params.chainId) {
        await switchChainViaProvider(provider, params.chainId);
      }
      const txParams: Record<string, string> = {
        from: wallet.address,
        to: params.to,
      };
      if (params.data) txParams.data = params.data;
      if (params.value) txParams.value = params.value;
      if (params.gas) txParams.gas = params.gas;

      const hash = await provider.request({
        method: 'eth_sendTransaction',
        params: [txParams],
      });
      return hash as string;
    }

    // For embedded wallets, sign + broadcast server-side via Privy (no prompt).
    if (params.chainId == null) throw new Error('chainId is required for embedded transactions');
    const address = wallet.address ?? lastAddressRef.current;
    if (!address) throw new Error('Wallet address unavailable — please try again.');
    // Resolve a FRESH access token at call time (see signTypedData above).
    const accessToken = await resolveAccessToken(getAccessToken, accessTokenRef.current);
    if (!accessToken) throw new Error('Not authenticated — please sign in again.');
    accessTokenRef.current = accessToken;
    return serverSendTransaction(address, params, accessToken);
  }, [activeWallet]);

  // Always return an adapter so login/logout work even when disconnected
  const adapter = useMemo((): WalletAdapter => {
    return {
      ready,
      address: stableAddress,
      chainId: stableChainId,
      signTypedData,
      switchChain,
      login,
      logout,
      fundWallet: hasExternalWallet ? undefined : handleFundWallet,
      hasExternalWallet,
      sendTransaction: handleSendTransaction,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, authenticated, stableAddress, stableChainId, signTypedData, switchChain, login, logout, handleFundWallet, hasExternalWallet, handleSendTransaction]);

  return adapter;
}

import { PrivyClient } from '@privy-io/node';
import type { TypedDataToSign } from '@compass-labs/widgets';

/**
 * Server-side signing with Privy — so the user is NEVER prompted to sign.
 *
 * The user's embedded wallet is delegated to the app's authorization key (a Privy
 * "key quorum") via a one-time `addSigners` on the client (see
 * `lib/hooks/useDelegateWallet.ts`). The server then signs/sends on that wallet
 * using ONLY the authorization key — no per-action user signature, no prompt.
 *
 * Required env (server-only):
 *   - PRIVY_APP_ID            (or NEXT_PUBLIC_PRIVY_APP_ID)
 *   - PRIVY_APP_SECRET
 *   - PRIVY_AUTHORIZATION_KEY (the key quorum's authorization private key; the
 *     `wallet-auth:` prefix, if present, is stripped)
 */

let client: PrivyClient | null = null;

function getClient(): PrivyClient {
  if (client) return client;
  const appId = process.env.PRIVY_APP_ID ?? process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error('Privy server signing not configured (PRIVY_APP_ID / PRIVY_APP_SECRET).');
  }
  client = new PrivyClient({ appId, appSecret });
  return client;
}

function authorizationKey(): string {
  const raw = process.env.PRIVY_AUTHORIZATION_KEY ?? '';
  if (!raw) throw new Error('Privy server signing not configured (PRIVY_AUTHORIZATION_KEY).');
  return raw.startsWith('wallet-auth:') ? raw.slice('wallet-auth:'.length) : raw;
}

/** Thrown when the requested signing address isn't owned by the caller. */
export class OwnershipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OwnershipError';
  }
}

/**
 * Enforce that `address` is one of the caller's OWN embedded wallets. The client
 * passes its Privy ACCESS token; we verify it (`utils().auth().verifyAccessToken`
 * — JWKS pre-wired from the app credentials, so no extra env), resolve the
 * authenticated user, and confirm the address is among their ethereum wallets.
 * Without this, any authenticated user could ask the server to sign for another
 * user's delegated wallet.
 *
 * We use the access token (not the identity token): it is Privy's primary,
 * always-available, auto-refreshing credential, so it is reliable inside the
 * Telegram WebView — whereas the identity token is null there unless the Privy
 * dashboard explicitly issues identity tokens.
 */
export async function assertWalletOwnership(accessToken: string, address: string): Promise<void> {
  if (!accessToken) throw new OwnershipError('Missing access token.');
  const privy = getClient();
  let userId: string;
  try {
    const payload = await privy.utils().auth().verifyAccessToken(accessToken);
    userId = payload.user_id;
  } catch {
    throw new OwnershipError('Invalid or expired access token.');
  }
  let user: unknown;
  try {
    user = await privy.users()._get(userId);
  } catch {
    throw new OwnershipError('Could not load the authenticated user.');
  }
  const accounts = ((user as { linked_accounts?: unknown }).linked_accounts ?? []) as Array<Record<string, unknown>>;
  const owned = new Set(
    accounts
      .filter(
        (a) =>
          (a.type === 'wallet' || a.type === 'smart_wallet') &&
          a.chain_type === 'ethereum' &&
          typeof a.address === 'string',
      )
      .map((a) => (a.address as string).toLowerCase()),
  );
  if (!owned.has(address.toLowerCase())) {
    throw new OwnershipError('Wallet does not belong to the authenticated user.');
  }
}

/** Resolve a user's embedded-wallet address to its Privy wallet id. */
async function walletIdForAddress(address: string): Promise<string> {
  const privy = getClient();
  const wallet = await privy.wallets().getWalletByAddress(
    { address } as unknown as Parameters<ReturnType<PrivyClient['wallets']>['getWalletByAddress']>[0],
  );
  const id = (wallet as { id?: string }).id;
  if (!id) throw new Error(`No Privy wallet found for address ${address}.`);
  return id;
}

/**
 * Normalize a Compass EIP-712 payload to Privy's `typed_data` shape. Mirrors the
 * old client adapter: build the EIP712Domain entry from the present domain
 * fields, PascalCase the (Speakeasy-camelCased) type keys so they match
 * `primaryType`, and snake-case the key to `primary_type`.
 */
function toPrivyTypedData(td: TypedDataToSign): Record<string, unknown> {
  const d = td.domain;
  const domainFields: { name: string; type: string }[] = [];
  if (d.name !== undefined) domainFields.push({ name: 'name', type: 'string' });
  if (d.version !== undefined) domainFields.push({ name: 'version', type: 'string' });
  if (d.chainId !== undefined) domainFields.push({ name: 'chainId', type: 'uint256' });
  if (d.verifyingContract !== undefined) domainFields.push({ name: 'verifyingContract', type: 'address' });

  const types: Record<string, unknown> = { EIP712Domain: domainFields };
  for (const [key, value] of Object.entries(td.types as Record<string, unknown>)) {
    if (key === 'EIP712Domain' || key === 'eip712Domain') continue;
    types[key.charAt(0).toUpperCase() + key.slice(1)] = value;
  }

  return { domain: d, types, primary_type: td.primaryType, message: td.message };
}

/** Sign EIP-712 typed data server-side with the delegated authorization key. */
export async function signTypedDataServer(address: string, typedData: TypedDataToSign): Promise<string> {
  const privy = getClient();
  const eth = privy.wallets().ethereum();
  const walletId = await walletIdForAddress(address);
  const res = await eth.signTypedData(walletId, {
    params: { typed_data: toPrivyTypedData(typedData) },
    authorization_context: { authorization_private_keys: [authorizationKey()] },
  } as unknown as Parameters<typeof eth.signTypedData>[1]);
  const signature = (res as { signature?: string }).signature;
  if (!signature) throw new Error('Privy did not return a signature.');
  return signature;
}

export interface ServerTxRequest {
  to: string;
  data?: string;
  value?: string;
  gas?: string;
  chainId: number;
}

/** Sign + broadcast an EVM transaction server-side with the delegated key. */
export async function sendTransactionServer(address: string, tx: ServerTxRequest): Promise<string> {
  const privy = getClient();
  const eth = privy.wallets().ethereum();
  const walletId = await walletIdForAddress(address);
  const transaction: Record<string, unknown> = { to: tx.to, chain_id: tx.chainId };
  if (tx.data) transaction.data = tx.data;
  if (tx.value && tx.value !== '0') transaction.value = tx.value;
  if (tx.gas) transaction.gas_limit = tx.gas;
  const res = await eth.sendTransaction(walletId, {
    caip2: `eip155:${tx.chainId}`,
    // The embedded wallet is a gasless EOA — it only ever holds USDC, never the
    // chain's native token. So EVERY server-signed tx MUST be gas-sponsored, or
    // it can never be mined: Privy still returns a hash for an unsponsored tx, so
    // it silently never lands (no money moves, no error — the caller sees a
    // phantom success). Requires a Privy dashboard gas-sponsorship policy that
    // covers this chain; `res.sponsored` reports whether it was actually applied.
    sponsor: true,
    params: { transaction },
    authorization_context: { authorization_private_keys: [authorizationKey()] },
  } as unknown as Parameters<typeof eth.sendTransaction>[1]);
  // Sponsored smart-account sends return before inclusion. In that case Privy
  // intentionally leaves `hash` empty and returns a user-operation hash plus a
  // transaction id. Treat that as a successful submission instead of reporting
  // a false 502 to the client.
  const { hash, sponsored, user_operation_hash: userOperationHash, transaction_id: transactionId } = res as {
    hash?: string;
    sponsored?: boolean;
    user_operation_hash?: string;
    transaction_id?: string;
  };
  const submissionHash = hash || userOperationHash;
  if (!submissionHash) throw new Error('Privy did not return a transaction or user-operation hash.');
  // Surface whether sponsorship actually applied — an unsponsored tx will never
  // mine, so this distinguishes a real send from a phantom one in the logs.
  console.info('[privy/send-transaction] submitted', {
    hash,
    userOperationHash,
    transactionId,
    sponsored,
    chainId: tx.chainId,
  });
  if (sponsored === false) {
    throw new Error(
      'Transaction was not gas-sponsored (no Privy sponsorship policy for this chain); it would never be mined.',
    );
  }
  return submissionHash;
}

/** Whether server-side signing is configured (used to decide client routing). */
export function privyServerSigningConfigured(): boolean {
  return Boolean(
    (process.env.PRIVY_APP_ID ?? process.env.NEXT_PUBLIC_PRIVY_APP_ID) &&
      process.env.PRIVY_APP_SECRET &&
      process.env.PRIVY_AUTHORIZATION_KEY,
  );
}

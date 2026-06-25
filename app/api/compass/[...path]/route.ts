import { createCompassHandler } from '@compass-labs/widgets/server';

/**
 * Server-side proxy for all Compass widget API calls.
 *
 * The widgets-sdk client components fetch hard-coded `/api/compass/...` URLs;
 * this catch-all forwards them to the Compass API with the secret key attached
 * server-side, so the key never reaches the browser.
 */
const handler = createCompassHandler({
  apiKey: process.env.COMPASS_API_KEY!,
  serverUrl: process.env.COMPASS_API_SERVER_URL,
  gasSponsorPrivateKey: process.env.GAS_SPONSOR_PK,
  rpcUrls: {
    ethereum: process.env.ETHEREUM_MAINNET_RPC_URL,
    base: process.env.BASE_MAINNET_RPC_URL,
    arbitrum: process.env.ARBITRUM_MAINNET_RPC_URL,
    hyperevm: process.env.HYPEREVM_MAINNET_RPC_URL,
  },
});

export const GET = handler;
export const POST = handler;

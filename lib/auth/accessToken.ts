/**
 * Resolve a fresh Privy ACCESS token at action time.
 *
 * The embedded-wallet adapter sends the Privy access token to the server, which
 * verifies it (`utils().auth().verifyAccessToken`) and confirms the caller owns
 * the wallet it's asked to sign for.
 *
 * We use the ACCESS token rather than the identity token because the identity
 * token is unreliable inside a Telegram Mini App:
 *   - it is only ever issued when the Privy app has identity tokens enabled, and
 *   - `getIdentityToken()` does a bare read with no refresh/issuance, so right
 *     after a cold reopen (Privy rehydrates the session asynchronously) it reads
 *     `null` even though the user is authenticated.
 * The access token has neither problem: it is the SDK's PRIMARY credential — the
 * bearer attached to every Privy API call — so `getAccessToken()` always returns
 * one for an authenticated user and transparently refreshes it when expired.
 *
 * `getAccessToken` is injected (rather than imported from `@privy-io/react-auth`
 * directly) so this is a pure, unit-testable function with no Privy/React
 * runtime coupling.
 *
 * @param getAccessToken Returns a fresh Privy access token (auto-refreshing).
 * @param cached         The last token we successfully resolved (resilience
 *                       fallback for a transient `getAccessToken` failure).
 */
export async function resolveAccessToken(
  getAccessToken: () => Promise<string | null>,
  cached: string | null,
): Promise<string | null> {
  try {
    const token = await getAccessToken();
    if (token) return token;
  } catch {
    // Network/SDK hiccup — fall back to the last token we held.
  }
  return cached;
}

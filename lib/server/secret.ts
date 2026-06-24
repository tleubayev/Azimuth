import { randomBytes } from 'node:crypto';

/**
 * Shared server-side HMAC secret for signing nonces and session cookies.
 *
 * The secret MUST be stable across all serverless instances, otherwise tokens
 * signed by one instance won't verify on another. We therefore source it from
 * the environment (a dedicated `NONCE_SECRET`, or the always-present
 * `TELEGRAM_BOT_TOKEN`).
 *
 * In production we HARD-FAIL when neither is set, rather than silently falling
 * back to a per-instance ephemeral secret — that fallback caused confusing,
 * intermittent cross-instance verification failures. In development we allow a
 * stable ephemeral secret so local work doesn't need any env setup.
 */

let ephemeral: Buffer | null = null;
let warned = false;

export function serverSecret(): Buffer {
  const fromEnv = process.env.NONCE_SECRET || process.env.TELEGRAM_BOT_TOKEN;
  if (fromEnv) return Buffer.from(fromEnv, 'utf8');

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'server_secret_unconfigured: set NONCE_SECRET (or TELEGRAM_BOT_TOKEN). A stable secret ' +
        'is required to sign nonces/sessions consistently across serverless instances.',
    );
  }

  if (!ephemeral) {
    ephemeral = randomBytes(32);
    if (!warned) {
      warned = true;
      console.warn(
        '[secret] No NONCE_SECRET / TELEGRAM_BOT_TOKEN set — using a DEV-ONLY ephemeral secret.',
      );
    }
  }
  return ephemeral;
}

/** Test-only: reset the dev ephemeral secret. */
export function __resetEphemeralSecretForTests(): void {
  ephemeral = null;
  warned = false;
}

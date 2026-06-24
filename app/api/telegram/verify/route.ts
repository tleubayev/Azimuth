import { isValid, parse } from '@telegram-apps/init-data-node';
import { getSession, setSession } from '@/lib/server/session';

/**
 * POST /api/telegram/verify
 *
 * Body: `{ initDataRaw: string }` — the raw, URL-encoded `initData` string
 * Telegram injects into the Mini App.
 *
 * Verifies the HMAC-SHA256 signature against `TELEGRAM_BOT_TOKEN` (key =
 * `HMAC("WebAppData", botToken)`), enforces `auth_date` freshness (≤ 1h to
 * limit replay), extracts the trusted Telegram user, and binds it to an
 * httpOnly session cookie.
 *
 * Never logs the bot token or raw initData.
 */
export const runtime = 'nodejs';

/** Max age of `auth_date`, in seconds. */
const AUTH_DATE_MAX_AGE_SECONDS = 3600;

export async function POST(req: Request): Promise<Response> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return Response.json(
      { ok: false, error: 'server_misconfigured' },
      { status: 500 },
    );
  }

  let initDataRaw: unknown;
  try {
    const body = (await req.json()) as { initDataRaw?: unknown };
    initDataRaw = body.initDataRaw;
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  if (typeof initDataRaw !== 'string' || initDataRaw.length === 0) {
    return Response.json(
      { ok: false, error: 'missing_init_data' },
      { status: 400 },
    );
  }

  // `isValid` checks the HMAC and (via `expiresIn`) the auth_date freshness,
  // returning a boolean instead of throwing.
  const valid = isValid(initDataRaw, botToken, {
    expiresIn: AUTH_DATE_MAX_AGE_SECONDS,
  });
  if (!valid) {
    return Response.json(
      { ok: false, error: 'invalid_init_data' },
      { status: 401 },
    );
  }

  // `true` → return camelCased keys (firstName, photoUrl, …) for both the
  // runtime value and the inferred type.
  const data = parse(initDataRaw, true);
  const user = data.user;
  if (!user) {
    return Response.json({ ok: false, error: 'no_user' }, { status: 400 });
  }

  // Bind the Telegram identity onto the (possibly existing TON) session — mirror
  // /api/ton/verify so re-verifying on every app load never drops a still-valid
  // verified tonAddress (which the bridge/withdraw flows and the TON "verified"
  // UI hint read back via /api/ton/session).
  const existing = await getSession();
  await setSession({
    telegramUserId: user.id,
    tonAddress: existing?.tonAddress,
    issuedAt: Math.floor(Date.now() / 1000),
  });

  return Response.json({
    ok: true,
    user: {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      username: user.username,
      languageCode: user.languageCode,
      isPremium: user.isPremium,
      photoUrl: user.photoUrl,
    },
  });
}

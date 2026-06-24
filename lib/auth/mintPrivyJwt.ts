import { createPublicKey } from 'node:crypto';
import { SignJWT, exportJWK, importPKCS8, type JWK } from 'jose';

/**
 * Optional TON-keyed identity: mint a short-lived JWT whose `sub` is the
 * verified TON address, so Privy custom-auth can provision an embedded EVM
 * wallet keyed to the TON wallet (instead of the Telegram account).
 *
 * Gated by `NEXT_PUBLIC_ENABLE_TON_KEYED_IDENTITY === 'true'` at the call sites.
 * This module is compiled but inert unless invoked.
 *
 * Inputs (server-only env):
 *   - PRIVY_JWT_PRIVATE_KEY  PEM (PKCS#8) signing key.
 *   - PRIVY_JWT_KID          key id (also exposed in the JWKS).
 *   - PRIVY_JWT_ISSUER       issuer / `iss` claim and audience anchor.
 *
 * NEVER log PRIVY_JWT_PRIVATE_KEY.
 */

/** Detected from the key type/curve. RSA → RS256; EC P-256/384/521 → ES256/384/512. */
type SupportedAlg = 'RS256' | 'ES256' | 'ES384' | 'ES512';

/** Maps an EC named curve to its JOSE alg. */
const EC_CURVE_ALG: Record<string, SupportedAlg> = {
  prime256v1: 'ES256', // P-256
  secp256r1: 'ES256',
  'P-256': 'ES256',
  secp384r1: 'ES384', // P-384
  'P-384': 'ES384',
  secp521r1: 'ES512', // P-521
  'P-521': 'ES512',
};

const TOKEN_TTL = '5m';

interface JwtConfig {
  privateKeyPem: string;
  kid: string;
  issuer: string;
}

function loadConfig(): JwtConfig {
  const privateKeyPem = process.env.PRIVY_JWT_PRIVATE_KEY;
  const kid = process.env.PRIVY_JWT_KID;
  const issuer = process.env.PRIVY_JWT_ISSUER;
  if (!privateKeyPem || !kid || !issuer) {
    throw new Error('ton_keyed_identity_misconfigured');
  }
  // Support base64-wrapped PEM (some hosts mangle multi-line env values).
  const pem = privateKeyPem.includes('-----BEGIN')
    ? privateKeyPem
    : Buffer.from(privateKeyPem, 'base64').toString('utf8');
  return { privateKeyPem: pem, kid, issuer };
}

/**
 * Determine the JWS alg from the key. RSA → RS256; EC → ES256/384/512 by curve.
 * Throws a clear config error for unsupported key types (Ed25519, etc.) instead
 * of silently signing with the wrong algorithm.
 */
function detectAlg(pem: string): SupportedAlg {
  // `createPublicKey` on a private PEM yields the public half; its
  // `asymmetricKeyType` tells us RSA vs EC, and the details give the curve.
  const pub = createPublicKey({ key: pem, format: 'pem' });
  const type = pub.asymmetricKeyType;

  // RSASSA-PKCS1-v1_5 keys → RS256. RSA-PSS keys are NOT supported: they are
  // incompatible with RS256, and jose's importPKCS8 (WebCrypto) cannot import an
  // RSA-PSS-OID PKCS#8 key for PS256 either — so fail loudly with a clear config
  // error instead of producing broken tokens. Privy custom-auth uses RSA/EC.
  if (type === 'rsa') return 'RS256';
  if (type === 'rsa-pss') {
    throw new Error(
      'ton_keyed_identity_unsupported_key: RSA-PSS keys are not supported — provide a ' +
        'standard RSA (PKCS#1) or EC P-256/384/521 PKCS#8 key.',
    );
  }

  if (type === 'ec') {
    const curve = pub.asymmetricKeyDetails?.namedCurve;
    const alg = curve ? EC_CURVE_ALG[curve] : undefined;
    if (!alg) {
      throw new Error(
        `ton_keyed_identity_unsupported_key: EC curve "${curve ?? 'unknown'}" is not supported ` +
          '(use P-256, P-384, or P-521).',
      );
    }
    return alg;
  }

  throw new Error(
    `ton_keyed_identity_unsupported_key: key type "${type ?? 'unknown'}" is not supported ` +
      '(use an RSA or EC P-256/384/521 PKCS#8 key).',
  );
}

/**
 * Sign a Privy custom-auth JWT for the given TON address.
 * @param tonAddress raw TON address ("0:abc…") → becomes the `sub` claim.
 */
export async function mintPrivyJwt(tonAddress: string): Promise<string> {
  const { privateKeyPem, kid, issuer } = loadConfig();
  const alg = detectAlg(privateKeyPem);
  const privateKey = await importPKCS8(privateKeyPem, alg);

  return new SignJWT({})
    .setProtectedHeader({ alg, kid, typ: 'JWT' })
    .setSubject(tonAddress)
    .setIssuer(issuer)
    .setAudience(issuer)
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .sign(privateKey);
}

/**
 * Build the public JWKS (single key) for the JWKS endpoint so Privy can verify
 * tokens minted by {@link mintPrivyJwt}. Returns only public material.
 */
export async function buildJwks(): Promise<{ keys: JWK[] }> {
  const { privateKeyPem, kid } = loadConfig();
  const alg = detectAlg(privateKeyPem);
  // Derive the public key from the private PEM, then export as a JWK.
  const publicKey = createPublicKey({ key: privateKeyPem, format: 'pem' });
  const jwk = await exportJWK(publicKey);
  return {
    keys: [
      {
        ...jwk,
        kid,
        alg,
        use: 'sig',
      },
    ],
  };
}

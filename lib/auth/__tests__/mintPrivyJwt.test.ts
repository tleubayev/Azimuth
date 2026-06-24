import { generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { mintPrivyJwt } from '@/lib/auth/mintPrivyJwt';

function pkcs8(privateKey: ReturnType<typeof generateKeyPairSync>['privateKey']): string {
  return privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
}

function setEnv(pem: string): void {
  process.env.PRIVY_JWT_PRIVATE_KEY = pem;
  process.env.PRIVY_JWT_KID = 'test-kid';
  process.env.PRIVY_JWT_ISSUER = 'https://test.example';
}

function headerAlg(jwt: string): string {
  const [h] = jwt.split('.');
  return JSON.parse(Buffer.from(h, 'base64url').toString('utf8')).alg as string;
}

describe('mintPrivyJwt detectAlg', () => {
  afterEach(() => {
    delete process.env.PRIVY_JWT_PRIVATE_KEY;
    delete process.env.PRIVY_JWT_KID;
    delete process.env.PRIVY_JWT_ISSUER;
  });

  it('signs an RSASSA-PKCS1 key with RS256', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    setEnv(pkcs8(privateKey));
    expect(headerAlg(await mintPrivyJwt('0:abc'))).toBe('RS256');
  });

  it('rejects an RSA-PSS key (incompatible with RS256, unsupported by the signer)', async () => {
    const { privateKey } = generateKeyPairSync('rsa-pss', { modulusLength: 2048 });
    setEnv(pkcs8(privateKey));
    await expect(mintPrivyJwt('0:abc')).rejects.toThrow(/unsupported_key/);
  });

  it('signs an EC P-256 key with ES256', async () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    setEnv(pkcs8(privateKey));
    expect(headerAlg(await mintPrivyJwt('0:abc'))).toBe('ES256');
  });

  it('throws a clear error for an unsupported key type (ed25519)', async () => {
    const { privateKey } = generateKeyPairSync('ed25519');
    setEnv(pkcs8(privateKey));
    await expect(mintPrivyJwt('0:abc')).rejects.toThrow(/unsupported_key/);
  });
});

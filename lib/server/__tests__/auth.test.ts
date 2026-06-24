import { beforeEach, describe, expect, it } from 'vitest';
import { isValid, sign } from '@telegram-apps/init-data-node';
import { beginCell, storeStateInit, WalletContractV4, WalletContractV5R1 } from '@ton/ton';
import { sha256 } from '@ton/crypto';
import nacl from 'tweetnacl';
import {
  consume,
  issue,
  __clearNonceStoreForTests,
} from '@/lib/server/nonceStore';
import {
  verifyTonProof,
  type TonProof,
  type VerifyTonProofArgs,
} from '@/lib/server/tonProof';

// ───────────────────────────── Telegram initData ────────────────────────────

const BOT_TOKEN = '123456:TEST_BOT_TOKEN_FOR_VITEST_DO_NOT_USE';

describe('Telegram initData verification', () => {
  it('accepts a freshly signed valid initData', () => {
    const initData = sign(
      {
        user: { id: 42, first_name: 'Ada' },
        query_id: 'q1',
      },
      BOT_TOKEN,
      new Date(),
    );
    expect(isValid(initData, BOT_TOKEN, { expiresIn: 3600 })).toBe(true);
  });

  it('rejects a tampered initData (mutated user payload)', () => {
    const initData = sign(
      { user: { id: 42, first_name: 'Ada' } },
      BOT_TOKEN,
      new Date(),
    );
    // Flip the user id while keeping the original hash → signature mismatch.
    const tampered = initData.replace('Ada', 'Mallory');
    expect(tampered).not.toBe(initData);
    expect(isValid(tampered, BOT_TOKEN, { expiresIn: 3600 })).toBe(false);
  });

  it('rejects initData signed with a different bot token', () => {
    const initData = sign(
      { user: { id: 7, first_name: 'Eve' } },
      'OTHER:WRONG_TOKEN',
      new Date(),
    );
    expect(isValid(initData, BOT_TOKEN, { expiresIn: 3600 })).toBe(false);
  });

  it('rejects an expired initData (stale auth_date)', () => {
    const old = new Date(Date.now() - 7200 * 1000); // 2h ago
    const initData = sign(
      { user: { id: 1, first_name: 'Old' } },
      BOT_TOKEN,
      old,
    );
    expect(isValid(initData, BOT_TOKEN, { expiresIn: 3600 })).toBe(false);
  });
});

// ─────────────────────────────── ton_proof ──────────────────────────────────

const DOMAIN = 'app.example.com';

interface CraftedProof {
  args: VerifyTonProofArgs;
  rawAddress: string;
}

/**
 * Build a valid ton_proof using a tweetnacl Ed25519 keypair and a real
 * WalletContractV4 stateInit, signing the exact digest the verifier rebuilds.
 */
async function craftValidProof(
  nonce: string,
  overrides: { timestamp?: number; domain?: string; wallet?: 'v4' | 'v5r1' } = {},
): Promise<CraftedProof> {
  const keyPair = nacl.sign.keyPair();
  const publicKey = Buffer.from(keyPair.publicKey);

  const wallet =
    overrides.wallet === 'v5r1'
      ? WalletContractV5R1.create({ workchain: 0, publicKey })
      : WalletContractV4.create({ workchain: 0, publicKey });
  const address = wallet.address;
  const rawAddress = address.toRawString();

  const stateInitCell = beginCell()
    .store(storeStateInit({ code: wallet.init.code, data: wallet.init.data }))
    .endCell();
  const walletStateInit = stateInitCell.toBoc().toString('base64');

  const timestamp =
    overrides.timestamp ?? Math.floor(Date.now() / 1000);
  const domainValue = overrides.domain ?? DOMAIN;
  const domainBytes = Buffer.from(domainValue, 'utf8');

  const wc = Buffer.alloc(4);
  wc.writeInt32BE(address.workChain);
  const domainLen = Buffer.alloc(4);
  domainLen.writeUInt32LE(domainBytes.length);
  const ts = Buffer.alloc(8);
  ts.writeBigUInt64LE(BigInt(timestamp));

  const message = Buffer.concat([
    Buffer.from('ton-proof-item-v2/', 'utf8'),
    wc,
    address.hash,
    domainLen,
    domainBytes,
    ts,
    Buffer.from(nonce, 'utf8'),
  ]);
  const inner = Buffer.from(await sha256(message));
  const full = Buffer.concat([
    Buffer.from([0xff, 0xff]),
    Buffer.from('ton-connect', 'utf8'),
    inner,
  ]);
  const digest = Buffer.from(await sha256(full));

  const signature = Buffer.from(
    nacl.sign.detached(new Uint8Array(digest), keyPair.secretKey),
  );

  const proof: TonProof = {
    timestamp,
    domain: { lengthBytes: domainBytes.length, value: domainValue },
    signature: signature.toString('base64'),
    payload: nonce,
  };

  return {
    rawAddress,
    args: {
      address: rawAddress,
      proof,
      walletStateInit,
      publicKey: publicKey.toString('hex'),
    },
  };
}

describe('ton_proof verification', () => {
  beforeEach(() => {
    __clearNonceStoreForTests();
  });

  it('accepts a correctly crafted proof', async () => {
    const nonce = issue();
    const { args, rawAddress } = await craftValidProof(nonce);
    const res = await verifyTonProof(args, {
      consumeNonce: consume,
      allowedDomain: DOMAIN,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.address).toBe(rawAddress);
    }
  });

  it('accepts a W5 (wallet v5r1) proof — what Telegram @wallet uses', async () => {
    // W5 stores the public key at a different offset than V3/V4, so naive
    // stateInit parsing returns the wrong bytes; verification must still accept
    // it via key→address reconstruction (regression for `public_key_mismatch`).
    const nonce = issue();
    const { args, rawAddress } = await craftValidProof(nonce, { wallet: 'v5r1' });
    const res = await verifyTonProof(args, {
      consumeNonce: consume,
      allowedDomain: DOMAIN,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.address).toBe(rawAddress);
    }
  });

  it('rejects a proof with a bad signature', async () => {
    const nonce = issue();
    const { args } = await craftValidProof(nonce);
    // Corrupt the signature (flip first base64 char to a different valid one).
    const sig = Buffer.from(args.proof.signature, 'base64');
    sig[0] ^= 0xff;
    const bad: VerifyTonProofArgs = {
      ...args,
      proof: { ...args.proof, signature: sig.toString('base64') },
    };
    const res = await verifyTonProof(bad, {
      consumeNonce: consume,
      allowedDomain: DOMAIN,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe('signature_invalid');
    }
  });

  it('rejects a reused nonce', async () => {
    const nonce = issue();
    const { args } = await craftValidProof(nonce);
    const first = await verifyTonProof(args, {
      consumeNonce: consume,
      allowedDomain: DOMAIN,
    });
    expect(first.ok).toBe(true);

    // Second attempt with the same (already consumed) nonce must fail.
    const second = await verifyTonProof(args, {
      consumeNonce: consume,
      allowedDomain: DOMAIN,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.reason).toBe('nonce_invalid');
    }
  });

  it('rejects a nonce that was never issued', async () => {
    const { args } = await craftValidProof('deadbeef-never-issued');
    const res = await verifyTonProof(args, {
      consumeNonce: consume,
      allowedDomain: DOMAIN,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe('nonce_invalid');
    }
  });

  it('rejects a stale timestamp', async () => {
    const nonce = issue();
    const stale = Math.floor(Date.now() / 1000) - 5000; // > 900s old
    const { args } = await craftValidProof(nonce, { timestamp: stale });
    const res = await verifyTonProof(args, {
      consumeNonce: consume,
      allowedDomain: DOMAIN,
      ttlSeconds: 900,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe('stale_timestamp');
    }
  });

  it('rejects a wrong domain', async () => {
    const nonce = issue();
    const { args } = await craftValidProof(nonce, { domain: 'evil.example.com' });
    const res = await verifyTonProof(args, {
      consumeNonce: consume,
      allowedDomain: DOMAIN,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe('domain_mismatch');
    }
  });

  it('does not consume the nonce when the domain check fails first', async () => {
    const nonce = issue();
    const { args } = await craftValidProof(nonce, { domain: 'evil.example.com' });
    const res = await verifyTonProof(args, {
      consumeNonce: consume,
      allowedDomain: DOMAIN,
    });
    expect(res.ok).toBe(false);
    // The nonce was rejected before reaching consume(), so it is still valid.
    expect(consume(nonce)).toBe(true);
  });

  it('rejects when a supplied publicKey contradicts the stateInit', async () => {
    const nonce = issue();
    const { args } = await craftValidProof(nonce);
    const wrongPk = Buffer.from(nacl.sign.keyPair().publicKey).toString('hex');
    const res = await verifyTonProof(
      { ...args, publicKey: wrongPk },
      { consumeNonce: consume, allowedDomain: DOMAIN },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe('public_key_mismatch');
    }
  });
});

// ─────────────────────────────── nonce store ────────────────────────────────

describe('nonce store', () => {
  beforeEach(() => {
    __clearNonceStoreForTests();
  });

  it('issues unique single-use nonces', () => {
    const a = issue();
    const b = issue();
    expect(a).not.toBe(b);
    expect(consume(a)).toBe(true);
    expect(consume(a)).toBe(false); // already burned
    expect(consume(b)).toBe(true);
  });

  it('rejects unknown nonces', () => {
    expect(consume('never-issued')).toBe(false);
  });
});

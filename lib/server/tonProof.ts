import {
  Address,
  Cell,
  contractAddress,
  loadStateInit,
  WalletContractV5R1,
  WalletContractV4,
  WalletContractV3R2,
  WalletContractV3R1,
} from '@ton/ton';
import { sha256 } from '@ton/crypto';
import nacl from 'tweetnacl';

/**
 * Pure (route-independent) ton_proof verification.
 *
 * Implements the algorithm from
 * `.context/ton-miniapp-research/03-telegram-tonconnect.md` §3:
 *
 *   message =
 *       utf8("ton-proof-item-v2/")
 *     ++ int32_BE(workchain)            // 4 bytes
 *     ++ address_hash                   // 32 bytes (account hash part)
 *     ++ uint32_LE(domain.lengthBytes)  // 4 bytes
 *     ++ utf8(domain.value)
 *     ++ uint64_LE(timestamp)           // 8 bytes
 *     ++ utf8(payload)
 *
 *   digest = sha256( 0xffff ++ utf8("ton-connect") ++ sha256(message) )
 *
 *   Ed25519.verify(digest, base64decode(signature), publicKey)
 *
 * Beyond the signature it also enforces the security-relevant policy checks:
 * single-use nonce, whitelisted domain, and timestamp freshness. The public key
 * is recovered from `walletStateInit` (and cross-checked against a supplied
 * `publicKey` if present); the stateInit is also bound to the claimed address.
 *
 * This function performs NO I/O and reads NO environment — the caller (the
 * route handler) injects the nonce-consume callback, allowed domain, and TTL —
 * which keeps it deterministic and unit-testable.
 */

/** The `proof` object returned by a TON Connect wallet. */
export interface TonProof {
  timestamp: number;
  domain: { lengthBytes: number; value: string };
  /** Base64-encoded Ed25519 signature. */
  signature: string;
  /** The nonce we issued, echoed back. */
  payload: string;
}

export interface VerifyTonProofArgs {
  /** Raw address string, e.g. "0:abc…" (workchain:hexhash). */
  address: string;
  proof: TonProof;
  /** Base64 BOC of the wallet's StateInit (`account.walletStateInit`). */
  walletStateInit: string;
  /** Optional hex public key claimed by the client; cross-checked if present. */
  publicKey?: string;
}

export interface VerifyTonProofOpts {
  /** Atomically verify-and-burn the nonce. Return `true` iff it was valid. */
  consumeNonce: (nonce: string) => boolean;
  /** Host that the proof's `domain.value` must equal (e.g. "app.vercel.app"). */
  allowedDomain: string;
  /** Max age of `proof.timestamp` in seconds (default 900 = 15 min). */
  ttlSeconds?: number;
  /** Override for the current unix-seconds clock (testing). */
  now?: () => number;
}

export type VerifyTonProofResult =
  | { ok: true; address: string }
  | { ok: false; reason: string };

const DEFAULT_TTL_SECONDS = 900;

/**
 * Wallet v3/v4 data-cell layout begins with `seqno:uint32, walletId:uint32`,
 * followed by the 256-bit (32-byte) public key. We skip 64 bits then read the
 * key. Newer layouts (v5) differ, so this is best-effort: extraction failures
 * fall back to the client-supplied `publicKey`.
 */
function tryExtractPublicKey(stateInitData: Cell | null | undefined): Buffer | null {
  if (!stateInitData) {
    return null;
  }
  try {
    const slice = stateInitData.beginParse();
    slice.skip(32); // seqno
    slice.skip(32); // walletId / subwallet
    return slice.loadBuffer(32);
  } catch {
    return null;
  }
}

/**
 * Does `publicKey` provably control `address`?
 *
 * Rather than parse the public key out of the wallet's data cell (the layout
 * differs per version — e.g. W5 puts it at a different bit offset than V3/V4, so
 * naive parsing yields the wrong bytes and a false mismatch), we reconstruct the
 * address from the key for each known wallet version. If any reproduces the
 * claimed address, the key genuinely owns that wallet — version-robust and with
 * no on-chain `get_public_key` call. Uses default wallet ids (what @wallet,
 * Tonkeeper, etc. use); a non-default subwallet id would simply not match.
 */
function publicKeyControlsAddress(publicKey: Buffer, address: Address): boolean {
  if (publicKey.length !== 32) {
    return false;
  }
  const wc = address.workChain;
  const makers = [
    () => WalletContractV5R1.create({ workchain: wc, publicKey }),
    () => WalletContractV4.create({ workchain: wc, publicKey }),
    () => WalletContractV3R2.create({ workchain: wc, publicKey }),
    () => WalletContractV3R1.create({ workchain: wc, publicKey }),
  ];
  for (const make of makers) {
    try {
      if (make().address.equals(address)) {
        return true;
      }
    } catch {
      /* version unavailable / construction failed — try the next */
    }
  }
  return false;
}

export async function verifyTonProof(
  args: VerifyTonProofArgs,
  opts: VerifyTonProofOpts,
): Promise<VerifyTonProofResult> {
  const { proof } = args;
  const ttl = opts.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const nowSeconds = (opts.now ?? (() => Math.floor(Date.now() / 1000)))();

  // 1. Domain whitelist — the wallet echoes the dapp domain it signed for.
  if (proof.domain.value !== opts.allowedDomain) {
    return { ok: false, reason: 'domain_mismatch' };
  }

  // 2. Freshness — reject stale (replayable) or future-dated proofs.
  if (!Number.isFinite(proof.timestamp)) {
    return { ok: false, reason: 'bad_timestamp' };
  }
  if (nowSeconds - proof.timestamp > ttl) {
    return { ok: false, reason: 'stale_timestamp' };
  }
  if (proof.timestamp - nowSeconds > ttl) {
    return { ok: false, reason: 'future_timestamp' };
  }

  // 3. Single-use nonce (replay protection). Consume LAST among cheap checks
  //    but BEFORE crypto, so a forged proof can't burn a fresh nonce after
  //    passing signature verification only to fail elsewhere.
  if (!opts.consumeNonce(proof.payload)) {
    return { ok: false, reason: 'nonce_invalid' };
  }

  // 4. Parse address + stateInit and bind them together.
  let addr: Address;
  let stateInitCell: Cell;
  try {
    addr = Address.parse(args.address);
    stateInitCell = Cell.fromBase64(args.walletStateInit);
  } catch {
    return { ok: false, reason: 'bad_address_or_state_init' };
  }

  let derived: Address;
  let stateInit;
  try {
    stateInit = loadStateInit(stateInitCell.beginParse());
    derived = contractAddress(addr.workChain, stateInit);
  } catch {
    return { ok: false, reason: 'bad_state_init' };
  }
  if (!derived.equals(addr)) {
    return { ok: false, reason: 'state_init_address_mismatch' };
  }

  // 5. Resolve + validate the public key. The proof is meaningful only if the
  //    key it's signed with provably CONTROLS the address — we check that by
  //    reconstructing the address from the key for known wallet versions
  //    (V3/V4/V5). This binds key↔address robustly, where naive stateInit
  //    parsing does not (e.g. W5 stores the key at a different offset, so the
  //    parsed bytes are wrong and the proof was falsely rejected as
  //    public_key_mismatch). Prefer the client-supplied key; if absent, fall
  //    back to the legacy-layout parse. Either way it must control the address.
  let publicKey: Buffer;
  if (args.publicKey) {
    try {
      publicKey = Buffer.from(args.publicKey, 'hex');
    } catch {
      return { ok: false, reason: 'bad_public_key' };
    }
  } else {
    const extracted = tryExtractPublicKey(stateInit.data ?? null);
    if (!extracted) {
      return { ok: false, reason: 'public_key_unavailable' };
    }
    publicKey = extracted;
  }
  if (publicKey.length !== 32) {
    return { ok: false, reason: 'bad_public_key' };
  }
  if (!publicKeyControlsAddress(publicKey, addr)) {
    return { ok: false, reason: 'public_key_mismatch' };
  }

  // 6. Rebuild the signed message exactly per spec.
  const wc = Buffer.alloc(4);
  wc.writeInt32BE(addr.workChain);
  const domainLen = Buffer.alloc(4);
  domainLen.writeUInt32LE(proof.domain.lengthBytes);
  const ts = Buffer.alloc(8);
  ts.writeBigUInt64LE(BigInt(proof.timestamp));

  const message = Buffer.concat([
    Buffer.from('ton-proof-item-v2/', 'utf8'),
    wc,
    addr.hash,
    domainLen,
    Buffer.from(proof.domain.value, 'utf8'),
    ts,
    Buffer.from(proof.payload, 'utf8'),
  ]);

  const innerHash = Buffer.from(await sha256(message));
  const full = Buffer.concat([
    Buffer.from([0xff, 0xff]),
    Buffer.from('ton-connect', 'utf8'),
    innerHash,
  ]);
  const digest = Buffer.from(await sha256(full));

  // 7. Ed25519 verification.
  let signature: Buffer;
  try {
    signature = Buffer.from(proof.signature, 'base64');
  } catch {
    return { ok: false, reason: 'bad_signature_encoding' };
  }
  if (signature.length !== 64) {
    return { ok: false, reason: 'bad_signature_length' };
  }

  const valid = nacl.sign.detached.verify(
    new Uint8Array(digest),
    new Uint8Array(signature),
    new Uint8Array(publicKey),
  );
  if (!valid) {
    return { ok: false, reason: 'signature_invalid' };
  }

  return { ok: true, address: addr.toRawString() };
}

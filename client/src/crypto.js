// SafeLight client-side E2EE crypto module (Phase 1)
//
// Protocol: per-message X25519 ECDH -> HKDF-SHA256 -> AES-256-GCM,
// packaged as a multi-recipient "sealed envelope" so BOTH the recipient
// and the sender can read the message (a 1:1 chat shows both sides).
//
// Identity keys: long-term X25519 keypair per user. The PUBLIC key is
// published to the server (user_public_keys). The PRIVATE key never leaves
// the client unencrypted; it is wrapped with a password-derived key (see
// keyvault.js) before being backed up to the server.
//
// Dependencies: NONE. Uses the native Web Crypto API (SubtleCrypto).
//   Requires X25519 support: Chrome/Edge 133+, Safari 17+, Firefox 132+.
//   (See E2EE_DESIGN.md "Browser support" for the @noble/curves fallback.)

const subtle = globalThis.crypto.subtle;
const te = new TextEncoder();
const td = new TextDecoder();

export const SUITE = 'x25519-hkdf-sha256+aes256gcm';
const WRAP_INFO = 'safelight-wrap-v1';

// ---------- base64 helpers (browser-safe) ----------
export function b64(bytes) {
  let s = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s);
}
export function ub64(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));

// ---------- identity keys ----------

// Generate a fresh long-term identity keypair.
// Returns raw public key bytes and a PKCS#8 private key blob (both base64).
export async function generateIdentityKeyPair() {
  const kp = await subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']);
  const pubRaw = new Uint8Array(await subtle.exportKey('raw', kp.publicKey));
  const privPkcs8 = new Uint8Array(await subtle.exportKey('pkcs8', kp.privateKey));
  return { publicKey: b64(pubRaw), privateKey: b64(privPkcs8) };
}

async function importPub(rawB64) {
  return subtle.importKey('raw', ub64(rawB64), { name: 'X25519' }, false, []);
}
async function importPriv(pkcs8B64) {
  return subtle.importKey('pkcs8', ub64(pkcs8B64), { name: 'X25519' }, false, ['deriveBits']);
}

async function ecdh(privKey, pubKey) {
  const bits = await subtle.deriveBits({ name: 'X25519', public: pubKey }, privKey, 256);
  return new Uint8Array(bits);
}

async function hkdfAesKey(sharedSecret, salt, info, usages) {
  const base = await subtle.importKey('raw', sharedSecret, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: te.encode(info) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    usages
  );
}

// 8-byte tag so a decrypting client can find its own wrap slot without trial.
// NOT a security boundary — just an index. AES-GCM still authenticates.
async function pubTag(rawB64) {
  const h = new Uint8Array(await subtle.digest('SHA-256', ub64(rawB64)));
  return b64(h.slice(0, 8));
}

// ---------- message encryption ----------

// Encrypt `plaintext` so every key in `recipientPubKeys` (base64 raw X25519
// public keys) can read it. Pass BOTH the other party's key and your own.
// `aad` cryptographically binds context (e.g. "conv:<id>|from:<id>|to:<id>").
// Returns a JSON string to store in messages.encrypted_content.
export async function encryptMessage(plaintext, recipientPubKeys, aad = '') {
  const cek = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const cekRaw = new Uint8Array(await subtle.exportKey('raw', cek));

  const civ = rand(12);
  const ct = new Uint8Array(
    await subtle.encrypt(
      { name: 'AES-GCM', iv: civ, additionalData: te.encode(aad) },
      cek,
      te.encode(plaintext)
    )
  );

  const recips = [];
  for (const pub of recipientPubKeys) {
    const eph = await subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']);
    const ephPub = new Uint8Array(await subtle.exportKey('raw', eph.publicKey));
    const shared = await ecdh(eph.privateKey, await importPub(pub));
    const wrapSalt = rand(16);
    const wIv = rand(12);
    const wKey = await hkdfAesKey(shared, wrapSalt, WRAP_INFO, ['encrypt']);
    const wrapped = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: wIv }, wKey, cekRaw));
    recips.push({
      rid: await pubTag(pub),
      epk: b64(ephPub),
      s: b64(wrapSalt),
      iv: b64(wIv),
      w: b64(wrapped),
    });
  }

  return JSON.stringify({ v: 1, suite: SUITE, aad, iv: b64(civ), ct: b64(ct), r: recips });
}

// Decrypt an envelope using my identity key. `myPrivateKey` is the base64
// PKCS#8 from generateIdentityKeyPair / vault unlock; `myPublicKey` is my raw
// public key (used only to locate my wrap slot). If `expectedAad` is provided,
// the envelope's bound context MUST match it, otherwise decryption is refused
// (this stops a message being replayed into a different conversation/pairing).
export async function decryptMessage(envelopeStr, myPrivateKey, myPublicKey, expectedAad = null) {
  let env;
  try {
    env = JSON.parse(envelopeStr);
  } catch {
    // Not an envelope (e.g. legacy plaintext row). Surface as-is.
    return { plaintext: envelopeStr, encrypted: false };
  }
  if (!env || env.v !== 1 || !Array.isArray(env.r)) {
    return { plaintext: envelopeStr, encrypted: false };
  }

  if (expectedAad != null && env.aad !== expectedAad) {
    throw new Error('Envelope context mismatch (possible replay)');
  }

  const myTag = await pubTag(myPublicKey);
  const slot = env.r.find((x) => x.rid === myTag);
  if (!slot) throw new Error('Message not encrypted to this key');

  const myPriv = await importPriv(myPrivateKey);
  const shared = await ecdh(myPriv, await importPub(slot.epk));
  const wKey = await hkdfAesKey(shared, ub64(slot.s), WRAP_INFO, ['decrypt']);
  const cekRaw = new Uint8Array(
    await subtle.decrypt({ name: 'AES-GCM', iv: ub64(slot.iv) }, wKey, ub64(slot.w))
  );
  const cek = await subtle.importKey('raw', cekRaw, { name: 'AES-GCM' }, false, ['decrypt']);
  const pt = await subtle.decrypt(
    { name: 'AES-GCM', iv: ub64(env.iv), additionalData: te.encode(env.aad || '') },
    cek,
    ub64(env.ct)
  );
  return { plaintext: td.decode(pt), encrypted: true };
}

// Build the AAD string that binds a message to its conversation + parties.
export function buildAad(conversationId, fromUserId, toUserId) {
  return `conv:${conversationId}|from:${fromUserId}|to:${toUserId}`;
}

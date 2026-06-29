// SafeLight key vault — password-derived wrapping of the identity private key.
//
// The private key is encrypted with a key derived from the user's password
// (PBKDF2-SHA256 -> AES-256-GCM) and backed up to the server as an opaque
// blob. The server never sees the password or the unwrapped key. A new device
// fetches the blob and unwraps it locally with the password.
//
// Phase-1 note: this ships with PBKDF2 (native, zero-dependency). Argon2id is
// stronger against GPU cracking and is the recommended upgrade — see
// E2EE_DESIGN.md "Key wrapping".

import { b64, ub64 } from './crypto';

const subtle = globalThis.crypto.subtle;
const te = new TextEncoder();
const PBKDF2_ITERATIONS = 310000;

// ---------- wrap / unwrap ----------

// `publicKeyB64` is stored alongside (it is not secret) so a new device can
// recover the full keypair from the vault + password alone.
export async function wrapPrivateKey(privateKeyB64, publicKeyB64, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const base = await subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveKey']);
  const kek = await subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, kek, ub64(privateKeyB64)));
  return {
    v: 1,
    kdf: 'PBKDF2-SHA256',
    iterations: PBKDF2_ITERATIONS,
    pub: publicKeyB64, // public key — not secret
    salt: b64(salt),
    iv: b64(iv),
    ct: b64(ct),
  };
}

export async function unwrapPrivateKey(bundle, password) {
  const base = await subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveKey']);
  const kek = await subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: ub64(bundle.salt), iterations: bundle.iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
  let priv;
  try {
    priv = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: ub64(bundle.iv) }, kek, ub64(bundle.ct)));
  } catch {
    throw new Error('Wrong password or corrupted key vault');
  }
  return { privateKey: b64(priv), publicKey: bundle.pub };
}

// ---------- in-memory session ----------
// The unwrapped private key lives only in this module's memory for the tab's
// lifetime. It is intentionally NOT persisted to localStorage/IndexedDB.
// On reload the app must unlock again (fetch vault + ask for password).

let _session = null; // { privateKey, publicKey, userId }

export function setSession({ privateKey, publicKey, userId }) {
  _session = { privateKey, publicKey, userId };
}
export function getSession() {
  return _session;
}
export function isUnlocked() {
  return _session != null;
}
export function lock() {
  _session = null;
}

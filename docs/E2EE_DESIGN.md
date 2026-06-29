# SafeLight End-to-End Encryption — Design (Phase 1)

This document specifies the Phase-1 E2EE design for SafeLight and describes the
reference implementation that ships with it. It is deliberately scoped to be
**correct and simple**, with a clean upgrade path to forward-secret sessions
(Double Ratchet) later.

- **Status:** reference implementation included and tested.
- **Crypto:** per-message X25519 ECDH → HKDF-SHA256 → AES-256-GCM, packaged as a
  multi-recipient sealed envelope.
- **Key storage:** identity private key wrapped with a password-derived key and
  backed up to the server as an opaque blob.
- **Schema:** no changes to the committed schema. One standalone, **uncommitted**
  migration adds the key-vault table (`migrations/002_key_vault.sql`).

---

## 1. Goals and non-goals

**Goals**

- The server stores and relays only ciphertext. It can never read message bodies.
- Both participants in a 1:1 conversation can read every message (including the
  sender's own sent messages, on any device).
- Confidentiality, integrity, and tamper-detection per message (AES-256-GCM).
- Context binding: a ciphertext is cryptographically tied to its conversation and
  the (sender, recipient) pair, so it cannot be silently replayed elsewhere.
- Cross-device: a user can log in on a new device with username + password and
  recover their keys.

**Non-goals (Phase 1 — see §9 for the upgrade path)**

- Forward secrecy / post-compromise security between messages (needs a ratchet).
- Cryptographic *sender* authentication (Phase 1 relies on the authenticated
  channel — JWT — to attest who posted a row; see §6).
- Group messaging, multiple devices with independent keys, attachments.
- Metadata protection (the server still sees who talks to whom and when).

**Threat model.** We protect message *content* against a passive or active server
operator and against database disclosure. We do **not** defend against a malicious
client endpoint, a compromised user password (which unlocks that user's vault), or
traffic-analysis of metadata.

---

## 2. Cryptographic primitives

| Purpose | Algorithm | Notes |
|---|---|---|
| Key agreement | X25519 (ECDH) | Native `SubtleCrypto`; ephemeral per message |
| KDF (message) | HKDF-SHA256 | Derives the AES wrap key from the ECDH secret |
| Content + wrap cipher | AES-256-GCM | 96-bit random IV, 128-bit tag |
| Password KDF (vault) | PBKDF2-SHA256, 310k iters | Argon2id recommended upgrade (§7) |

All primitives use the browser-native **Web Crypto API** — the reference
implementation has **zero runtime dependencies**.

### Browser support
WebCrypto X25519 requires Chrome/Edge 133+, Safari 17+, Firefox 132+. If you must
support older browsers, swap the X25519 calls for [`@noble/curves`](https://github.com/paulmillr/noble-curves)
(audited, universal) and keep AES-GCM/HKDF/PBKDF2 on WebCrypto. The module
boundary in `crypto.js` isolates exactly the four X25519 calls that would change.

---

## 3. Keys

Each user has one **long-term identity keypair** (X25519):

- **Public key** — published to the server in the existing `user_public_keys`
  table at registration (`key_id = 1`). The schema already supports rotation
  (`current_key_id`, `is_active`, `revoked_at`).
- **Private key** — generated in the browser, **never** sent to the server in the
  clear. It is wrapped (encrypted) with a password-derived key and backed up as an
  opaque blob (§7).

The registration form previously sent the literal string `'placeholder_public_key'`.
That is now replaced by a real generated public key.

---

## 4. Message envelope (multi-recipient sealed box)

A 1:1 chat must show messages to **both** parties, so a plain ephemeral-static
"seal to the recipient" box is insufficient (the sender couldn't re-read its own
messages on a new device). Instead each message uses a **random content key (CEK)**
that is wrapped independently for every reader.

**Encrypting a message** (`encryptMessage`):

1. Generate a random 256-bit **CEK**.
2. Encrypt the plaintext: `ct = AES-256-GCM(CEK, iv, plaintext, aad)`.
3. For each reader public key `P` (here: the recipient *and* the sender):
   a. Generate an ephemeral X25519 keypair `(e, E)`.
   b. `shared = X25519(e, P)`.
   c. `wrapKey = HKDF-SHA256(shared, saltᵢ, "safelight-wrap-v1")`.
   d. `wrapped = AES-256-GCM(wrapKey, ivᵢ, CEK)`.
   e. Emit a slot `{ rid, epk=E, s=saltᵢ, iv=ivᵢ, w=wrapped }`.
4. Store everything as a single JSON string in `messages.encrypted_content`.

`rid` is the first 8 bytes of `SHA-256(P)` — an **index only** so a reader can find
its own slot without trial-decrypting. It is not a security boundary; AES-GCM is.

**Envelope shape**

```json
{
  "v": 1,
  "suite": "x25519-hkdf-sha256+aes256gcm",
  "aad": "conv:<id>|from:<senderId>|to:<recipientId>",
  "iv":  "<b64 content IV>",
  "ct":  "<b64 AES-GCM ciphertext+tag of the body>",
  "r": [
    { "rid": "<b64 tag>", "epk": "<b64 ephemeral pub>", "s": "<b64 salt>", "iv": "<b64>", "w": "<b64 wrapped CEK>" }
  ]
}
```

**Decrypting** (`decryptMessage`): verify `aad` matches the expected context,
locate my slot by `rid`, `shared = X25519(myPriv, epk)`, derive the wrap key,
unwrap the CEK, then AES-GCM-decrypt the body. Any mismatch (wrong key, tampered
bytes, wrong conversation) throws.

### AAD context binding
The `aad` string `conv:<id>|from:<from>|to:<to>` is authenticated by GCM and
**checked on decrypt**. Without the check, a stored ciphertext could be moved to a
different conversation row and still decrypt; with it, the reader refuses anything
whose bound context doesn't match where it was found.

---

## 5. Key lifecycle and flows

### Registration
```
browser: generate X25519 identity keypair
  POST /auth/register { username, email, password, public_key }   ← public key only
browser: bundle = wrap(privateKey, publicKey, password)           ← PBKDF2 → AES-GCM
  PUT  /me/keyvault { bundle }                                     ← opaque blob
browser: hold {privateKey, publicKey, userId} in memory (session)
```

### Login (new or returning device)
```
  POST /auth/login { email, password } → JWT
  GET  /me/keyvault → bundle
browser: {privateKey, publicKey} = unwrap(bundle, password)       ← local, password never sent for this
browser: hold session in memory
```

### Sending a message
```
  GET  /conversations/:id/recipient-key → { user_id, username, key_id, public_key }
browser: envelope = encryptMessage(text, [recipientPub, myPub], aad)
  POST /conversations/:id/messages { encrypted_content: envelope, recipient_key_id, crypto_suite }
```

### Reading messages
```
  GET  /conversations/:id/messages → rows (encrypted_content = envelope)
browser: for each row, decryptMessage(envelope, myPriv, myPub, expectedAad)
```

---

## 6. What the server can and cannot do

- **Cannot** read message bodies, the CEKs, or any private key.
- **Can** see metadata: who messages whom, timestamps, message sizes, read
  receipts. (Out of scope for Phase 1.)
- **Sender authenticity** in Phase 1 comes from the *channel*: a message row is
  written under the poster's JWT (`sender_id`). The envelope itself is a sealed
  box and carries no signature, so a malicious server could in principle fabricate
  a row "from" someone — it just couldn't make it decrypt to chosen content for
  the victim without their key. Cryptographic sender authentication (signatures or
  a static-static MAC) is part of the Phase-2 upgrade.

---

## 7. Key wrapping (the vault)

The private key is wrapped before backup:

```
KEK = PBKDF2-SHA256(password, salt, 310_000)         // 256-bit
bundle = { v, kdf, iterations, pub, salt, iv,
           ct = AES-256-GCM(KEK, iv, privateKeyPkcs8) }
```

- `pub` (public key) is stored in the clear in the bundle — it is not secret and
  lets a new device recover the full keypair from bundle + password alone.
- The bundle is stored server-side in `user_key_vault` (opaque JSONB). The server
  validates only that ciphertext fields are present and never inspects contents; a
  DB-level `CHECK` rejects an accidentally-plaintext bundle.

**Recommended upgrade: Argon2id.** PBKDF2 ships here because it is native and
zero-dependency, but it is comparatively weak against GPU/ASIC cracking. Replacing
the KDF with Argon2id (e.g. via `hash-wasm`) is a drop-in change in `keyvault.js`;
record the algorithm + parameters in the `kdf`/`iterations` fields so old bundles
remain decryptable.

**Consequences of the password-derived model (as chosen):** works across devices;
**losing the password loses message history** (there is no recovery escrow). An
optional separate recovery code could be layered on later.

### Session handling
The unwrapped private key lives **only in memory** for the tab's lifetime
(`keyvault.js` session singleton). It is intentionally not written to
`localStorage`/`IndexedDB`. On reload the app must unlock again (fetch vault +
prompt for password). This trades a little UX for a much smaller key-exposure
surface; a deliberate IndexedDB cache could be added if persistent unlock is
desired.

---

## 8. API & schema changes

**New endpoints**

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/me/keyvault` | Fetch my encrypted key bundle (404 if none) |
| `PUT` | `/me/keyvault` | Store/replace my encrypted key bundle |
| `GET` | `/conversations/:id/recipient-key` | The other member's current public key + `key_id` |

**Registration** now requires a real `public_key` (already accepted by
`/auth/register`). **Send-message** now also accepts `recipient_key_id` and
`crypto_suite` (already accepted by the route; the client now populates them).

**Schema (uncommitted).** `migrations/002_key_vault.sql` adds:

```sql
CREATE TABLE user_key_vault (
  user_id    UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  bundle     JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Per request, this is delivered as a standalone migration and is **not** folded
into `schema_p.sql`. Apply it manually:
`psql "$DATABASE_URL" -f migrations/002_key_vault.sql`.

No changes are needed to `users`, `user_public_keys`, `conversations`, or
`messages` — the existing columns (`encrypted_content`, `recipient_key_id`,
`sender_ephemeral_pubkey`, `crypto_suite`) already accommodate the envelope.

---

## 9. Known limitations & upgrade path

1. **No forward secrecy.** Compromise of a long-term identity private key exposes
   all past messages wrapped to it. → Adopt **X3DH + Double Ratchet**: add prekey
   bundles (the schema's `user_public_keys` + a prekeys table) and per-conversation
   ratchet state; the per-message `sender_ephemeral_pubkey` column is already there
   to carry ratchet public keys.
2. **No cryptographic sender authentication** (§6). → Add an Ed25519 signing key
   per identity and sign the envelope, or switch wrapping to authenticated
   static-static ECDH.
3. **PBKDF2** for the vault. → Argon2id (§7).
4. **Metadata exposure.** → Sealed-sender techniques (later phase).
5. **Trust on first use — mitigated.** Public keys are fetched from the server.
   Users can now verify a contact via a **safety number** (`safetyNumber()` in
   `crypto.js`, surfaced by the chat's "tap to verify contact" panel): an iterated
   SHA-512 over both identity keys, combined in canonical order so both sides see
   the same 60 digits. Matching numbers read over a trusted channel rule out a
   key-swapping MITM. Remaining gap: verification state isn't persisted/pinned, so
   a later key change isn't yet flagged — add a "verified" pin + change alert next.

---

## 10. Reference implementation map

| File | Role |
|---|---|
| `client/src/crypto.js` | Envelope encrypt/decrypt, X25519/HKDF/AES-GCM, AAD binding |
| `client/src/keyvault.js` | Password wrap/unwrap of the private key + in-memory session |
| `client/src/api.js` | New `getRecipientKey`, `getKeyVault`, `putKeyVault`; richer `sendMessage` |
| `client/src/pages/register.jsx` | Real keygen → publish public key → back up wrapped private key |
| `client/src/pages/login.jsx` | Fetch vault → unlock with password |
| `client/src/pages/chat.jsx` | Encrypt on send, decrypt on load, AAD per message |
| `src/routes/me.js` | `GET`/`PUT /me/keyvault` (opaque blob) |
| `src/routes/conversations.js` | `GET /conversations/:id/recipient-key` |
| `migrations/002_key_vault.sql` | Key-vault table (standalone, uncommitted) |

### Tested behaviours
The crypto modules were exercised under Node against the real source files:
two-party decrypt (recipient + sender), third-party rejection (no slot),
GCM tamper rejection, AAD/replay-mismatch rejection, legacy-plaintext
passthrough, vault wrap/unwrap round-trip, wrong-password rejection, and
decryption with a vault-restored key.

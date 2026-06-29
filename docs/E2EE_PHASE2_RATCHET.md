# SafeLight E2EE — Phase 2: X3DH + Double Ratchet (Design Sketch)

Phase 1 (`E2EE_DESIGN.md`) gives confidentiality, integrity, and context binding,
but **no forward secrecy (FS)** and **no post-compromise security (PCS)**: if a
long-term identity private key leaks, every past and future message wrapped to it
is exposed. Phase 2 closes that gap by adopting the Signal protocol stack —
**X3DH** for the initial key agreement and the **Double Ratchet** for per-message
key evolution — plus real cryptographic sender authentication.

This is a design sketch (no code yet). It is written to drop onto the existing
schema and REST+polling transport with minimal disruption.

---

## 1. What Phase 2 adds

| Property | Phase 1 | Phase 2 |
|---|---|---|
| Confidentiality / integrity | ✅ | ✅ |
| Forward secrecy (past msgs safe after key leak) | ❌ | ✅ (symmetric + DH ratchet) |
| Post-compromise security (recover after leak) | ❌ | ✅ (DH ratchet) |
| Cryptographic sender authentication | ❌ (channel/JWT only) | ✅ (X3DH-authenticated session) |
| Async first message (recipient offline) | n/a | ✅ (prekeys) |
| Deniability | partial | ✅ (X3DH design property) |

---

## 2. Key material

Each user publishes a **key bundle** to the server (the server is an untrusted
directory; safety numbers / verification still guard against swaps):

- **Identity key (IK)** — long-term. Two flavours: an X25519 key for DH and an
  **Ed25519** key for signatures (or one Ed25519 converted to X25519 via the
  standard birational map). New vs. Phase 1: we now need a *signing* key.
- **Signed prekey (SPK)** — medium-term X25519 key, signed by IK-Ed25519, rotated
  periodically (e.g. weekly).
- **One-time prekeys (OPK)** — a pool of single-use X25519 keys; the server hands
  out and deletes one per session initiation. Replenished by the client when low.

All **private** keys stay client-side, wrapped in the existing password vault
(extend the vault bundle to hold IK + SPK + OPK privates + ratchet state, or store
ratchet state in IndexedDB; see §7).

---

## 3. X3DH — establishing a session

Initiator **A** wants to message **B** (who may be offline). A fetches B's bundle
`(IK_B, SPK_B, sig, OPK_B?)` from the server and verifies `sig` over `SPK_B` with
`IK_B`. A generates an ephemeral key `EK_A` and computes:

```
DH1 = DH(IK_A,  SPK_B)
DH2 = DH(EK_A,  IK_B)
DH3 = DH(EK_A,  SPK_B)
DH4 = DH(EK_A,  OPK_B)        // omitted if no OPK available
SK  = HKDF(DH1 || DH2 || DH3 || DH4)
```

`SK` seeds the Double Ratchet root key. A sends an **initial message** carrying
`IK_A`, `EK_A`, the consumed OPK id, and the first ratchet message. B performs the
mirror computation to derive the same `SK`. The mixed DHs are what authenticate
both parties and provide deniability.

---

## 4. Double Ratchet — per-message keys

Two interlocking ratchets evolve keys so each message uses a fresh key:

- **Symmetric-key (KDF) ratchet:** within a sending run, a per-message chain key
  advances `CK → CK'`, deriving a unique message key `MK` each step. Old `MK`/`CK`
  are deleted → **forward secrecy**.
- **Diffie-Hellman ratchet:** whenever the direction of conversation turns, each
  side ratchets a new DH keypair and mixes a fresh `DH(send, recv)` into the root
  key → **post-compromise security** (a one-time leak heals after the next round
  trip).

Each message header carries the sender's current ratchet public key and counters
`(N, PN)` so the receiver can derive/skip the right message key. **Skipped message
keys** are cached (bounded) so out-of-order / polled delivery still decrypts.

Message body encryption stays **AES-256-GCM** with an HMAC/AAD binding the header —
the same primitives Phase 1 already uses.

---

## 5. Fit with REST + polling

The Double Ratchet is transport-agnostic and works fine over polling:

- **Ordering:** `messages.sent_at, id` already gives a stable order; the ratchet's
  `(N, PN)` counters + skipped-key cache handle gaps and reordering from polling.
- **Initial message:** the X3DH prelude rides in the first message row (new columns
  or a typed "prekey message"). Subsequent rows are ordinary ratchet messages.
- **Wire format:** keep storing a self-describing JSON envelope in
  `messages.encrypted_content`, bumped to `suite: "x3dh+doubleratchet/aes256gcm"`
  with a header block `{ dh, n, pn }` alongside `iv`/`ct`.

No websockets required; real-time only improves latency, not correctness.

---

## 6. Schema additions (proposed, would be a future migration)

Phase 1 deliberately avoided schema changes; Phase 2 needs a few. Sketch:

```sql
-- Signing identity (Ed25519), in addition to the X25519 key in user_public_keys
ALTER TABLE users ADD COLUMN identity_signing_key TEXT;  -- base64 Ed25519 public

-- Signed prekeys (rotated)
CREATE TABLE signed_prekeys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_id INTEGER NOT NULL,
  public_key TEXT NOT NULL,
  signature TEXT NOT NULL,                 -- Ed25519 sig over public_key
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  retired_at TIMESTAMPTZ,
  UNIQUE(user_id, key_id)
);

-- One-time prekeys (consumed on use)
CREATE TABLE one_time_prekeys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_id INTEGER NOT NULL,
  public_key TEXT NOT NULL,
  consumed_at TIMESTAMPTZ,
  UNIQUE(user_id, key_id)
);
CREATE INDEX idx_otpk_unused ON one_time_prekeys(user_id) WHERE consumed_at IS NULL;
```

Ratchet **session state** (root key, chain keys, skipped keys, counters) is
**private** and never touches the server — keep it client-side (IndexedDB,
encrypted under the vault KEK). The `messages.sender_ephemeral_pubkey` column from
Phase 1 is repurposed to carry the ratchet public key (or fold it into the JSON
header).

**New endpoints:** `PUT /me/prekeys` (publish SPK + OPK batch), `GET
/users/:username/prekey-bundle` (atomically returns IK + SPK + one OPK and marks
the OPK consumed).

---

## 7. Multi-device note

X3DH/Double Ratchet sessions are **per-device-pair**. True multi-device (Signal's
Sesame) treats each device as its own identity and fans out a message to every
recipient device session. If multi-device is wanted, plan for: per-device identity
keys, a device list per user, and sender-side fan-out — larger than this sketch.
Phase 2 as written assumes one active device per user (matching Phase 1's vault).

---

## 8. Migration & coexistence with Phase 1

1. **Additive rollout.** Ship signing keys + prekey publication first; clients keep
   sending Phase-1 sealed envelopes until both sides advertise Phase-2 capability.
2. **Capability negotiation.** A `crypto_suite` already exists per message. A client
   that sees the peer has a valid prekey bundle initiates X3DH; otherwise it falls
   back to the Phase-1 envelope. Mixed history is fine — `decrypt` dispatches on
   `suite`/`v`.
3. **No history re-encryption.** Old Phase-1 messages stay as-is and remain
   readable with the identity key; only new sessions get the ratchet.
4. **Don't reuse OPKs.** Server must atomically consume one-time prekeys; replenish
   client-side when the pool runs low.

---

## 9. Build checklist (when implementing)

- [ ] Add Ed25519 identity signing key; extend vault to store it.
- [ ] Prekey generation + `PUT /me/prekeys`; low-watermark replenishment.
- [ ] `GET /users/:username/prekey-bundle` with atomic OPK consumption.
- [ ] X3DH initiator + responder; derive `SK`.
- [ ] Double Ratchet: root/chain ratchets, header `(dh, n, pn)`, skipped-key cache.
- [ ] Envelope `v2` + `suite` dispatch in `decryptMessage`; Phase-1 fallback.
- [ ] Encrypted client-side session store (IndexedDB under vault KEK).
- [ ] Safety number: extend to include the signing key; pin "verified" state and
      alert on identity-key change.
- [ ] Tests: FS (delete keys, confirm old MK can't decrypt new), PCS (heal after
      simulated leak), out-of-order/skipped delivery, prekey exhaustion fallback.

> Recommendation: implement against a vetted library (e.g. `libsignal`) rather than
> hand-rolling the ratchet. The value of this doc is the SafeLight-specific wiring
> (schema, endpoints, polling fit, Phase-1 coexistence), not re-deriving Signal.

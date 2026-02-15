-- Safelight Simple-E2EE Messaging App - CORE SCHEMA (MVP)
-- PostgreSQL / Neon
-- Phase 1: 1-on-1 messaging with simple public-key encryption (no Signal sessions yet)
-- Designed so you can upgrade later (devices, sessions, groups, attachments) without a rewrite.

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================
-- USERS
-- ============================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_online BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_email ON users(email);

-- ============================================
-- USER PUBLIC KEYS (simple E2EE, supports rotation)
-- Store public keys separately so you can rotate keys later.
-- The server never stores private keys.
-- ============================================
CREATE TABLE user_public_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key_id INTEGER NOT NULL,                      -- client-defined identifier (or server-issued)
    public_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT true,
    UNIQUE(user_id, key_id)
);

CREATE INDEX idx_user_public_keys_user_active ON user_public_keys(user_id, is_active);

-- One "current" key pointer on the user for convenience
ALTER TABLE users
ADD COLUMN current_key_id INTEGER;

ALTER TABLE users
ADD CONSTRAINT fk_users_current_key
FOREIGN KEY (id, current_key_id)
REFERENCES user_public_keys(user_id, key_id);

-- ============================================
-- CONVERSATIONS (1-on-1)
-- Use canonical ordering so each pair has exactly one conversation row.
-- This is the key upgrade path for groups later: you will add a conversations.type and group tables.
-- ============================================
CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_low UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_high UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_conversations_distinct_users CHECK (user_low <> user_high),
    CONSTRAINT chk_conversations_canonical CHECK (user_low < user_high),
    UNIQUE(user_low, user_high)
);

CREATE INDEX idx_conversations_user_low ON conversations(user_low);
CREATE INDEX idx_conversations_user_high ON conversations(user_high);

-- ============================================
-- CONVERSATION MEMBERS (per-user state for the conversation)
-- Even though this is 1-on-1 now, this structure makes groups easy later.
-- Read receipts: store "last read" at the conversation level for MVP.
-- ============================================
CREATE TABLE conversation_members (
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    last_read_message_id UUID,     -- points to messages.id
    last_read_at TIMESTAMPTZ,

    muted BOOLEAN NOT NULL DEFAULT false,
    blocked BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX idx_conv_members_user ON conversation_members(user_id);
CREATE INDEX idx_conv_members_conv ON conversation_members(conversation_id);

-- ============================================
-- MESSAGES
-- encrypted_content is opaque to server.
-- sender_ephemeral_pubkey supports simple "ephemeral sender key per message" patterns (optional),
-- and also makes later upgrades smoother (sessions, ratchets).
-- recipient_key_id records which recipient public key was used for encryption.
-- ============================================
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    encrypted_content TEXT NOT NULL,

    -- optional metadata for simple E2EE
    sender_ephemeral_pubkey TEXT,
    recipient_key_id INTEGER,                  -- which key of the recipient was used
    crypto_suite VARCHAR(50) NOT NULL DEFAULT 'x25519+aesgcm',  -- client-defined label

    sent_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- For 1-on-1 MVP you can store delivery/read timestamps on the message.
    delivered_at TIMESTAMPTZ,
    read_at TIMESTAMPTZ,

    is_deleted BOOLEAN NOT NULL DEFAULT false,
    deleted_at TIMESTAMPTZ
);

-- Fast conversation timeline fetch
CREATE INDEX idx_messages_conversation_time
ON messages(conversation_id, sent_at DESC)
WHERE is_deleted = false;

-- Fast "my sent messages" queries
CREATE INDEX idx_messages_sender_time
ON messages(sender_id, sent_at DESC);

-- ============================================
-- CONTACTS (optional MVP feature)
-- Directional relationship, includes block flag.
-- ============================================
CREATE TABLE contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    contact_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    added_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    blocked BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT chk_contacts_not_self CHECK (user_id <> contact_user_id),
    UNIQUE(user_id, contact_user_id)
);

CREATE INDEX idx_contacts_user ON contacts(user_id);

-- ============================================
-- HELPFUL VIEW: conversation list for a user (last message + unread count)
-- Avoid CROSS JOIN explosions. Uses LATERAL for latest message per conversation.
-- Unread is computed from conversation_members.last_read_at.
-- ============================================
CREATE VIEW user_conversations AS
SELECT
    cm.user_id,
    c.id AS conversation_id,
    other.id AS other_user_id,
    other.username AS other_username,
    other.is_online AS other_user_online,

    lm.id AS last_message_id,
    lm.encrypted_content AS last_message,
    lm.sent_at AS last_message_time,

    (
        SELECT COUNT(*)
        FROM messages m
        WHERE m.conversation_id = c.id
          AND m.is_deleted = false
          AND m.sender_id = other.id
          AND (
                cm.last_read_at IS NULL
                OR m.sent_at > cm.last_read_at
              )
    ) AS unread_count
FROM conversation_members cm
JOIN conversations c ON c.id = cm.conversation_id
JOIN LATERAL (
    SELECT
        CASE WHEN c.user_low = cm.user_id THEN c.user_high ELSE c.user_low END AS other_user_id
) ou ON true
JOIN users other ON other.id = ou.other_user_id
LEFT JOIN LATERAL (
    SELECT m.*
    FROM messages m
    WHERE m.conversation_id = c.id
      AND m.is_deleted = false
    ORDER BY m.sent_at DESC
    LIMIT 1
) lm ON true;

-- ============================================
-- OPTIONAL: system user (safer than fake password hashes)
-- ============================================
ALTER TABLE users ADD COLUMN is_system BOOLEAN NOT NULL DEFAULT false;

INSERT INTO users (username, email, password_hash, is_system)
VALUES ('system', 'system@safelight.app', '', true)
ON CONFLICT (username) DO NOTHING;

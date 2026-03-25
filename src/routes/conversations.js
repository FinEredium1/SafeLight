const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// conversation list
router.get('/', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        conversation_id,
        other_user_id,
        other_username,
        other_user_online,
        last_message,
        last_message_time,
        unread_count
       FROM user_conversations
       WHERE user_id = $1
       ORDER BY last_message_time DESC NULLS LAST`,
      [req.user.id]
    );

    return res.json({ conversations: result.rows });

  } catch (err) {
    console.error('[conversation list]', err.message);
    return res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});


router.post('/with/:username', authMiddleware, async (req, res) => {
  const { username } = req.params;


  if (username === req.user.username) {
    return res.status(400).json({ error: 'Cannot start a conversation with yourself' });
  }

  const client = await pool.connect();

  try {
    const otherResult = await client.query(
      `SELECT id, username FROM users WHERE username = $1 AND is_system = false`,
      [username]
    );

    if (!otherResult.rows[0]) {
      return res.status(404).json({ error: 'User not found' });
    }

    const other = otherResult.rows[0];

    const [user_low, user_high] = [req.user.id, other.id].sort();

    await client.query('BEGIN');

    await client.query(
      `INSERT INTO conversations (user_low, user_high)
       VALUES ($1, $2)
       ON CONFLICT (user_low, user_high) DO NOTHING`,
      [user_low, user_high]
    );

    const convResult = await client.query(
      `SELECT id FROM conversations WHERE user_low = $1 AND user_high = $2`,
      [user_low, user_high]
    );

    const conversationId = convResult.rows[0].id;

    await client.query(
      `INSERT INTO conversation_members (conversation_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (conversation_id, user_id) DO NOTHING`,
      [conversationId, req.user.id]
    );

    await client.query(
      `INSERT INTO conversation_members (conversation_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (conversation_id, user_id) DO NOTHING`,
      [conversationId, other.id]
    );

    await client.query('COMMIT');

    return res.status(200).json({
      conversation_id: conversationId,
      with: {
        id: other.id,
        username: other.username,
      }
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[conversation create]', err.message);
    return res.status(500).json({ error: 'Failed to create conversation' });
  } finally {
    client.release();
  }
});


// send message
router.post('/:conversationId/messages', authMiddleware, async (req, res) => {
  const { conversationId } = req.params;
  const { encrypted_content, recipient_key_id, sender_ephemeral_pubkey, crypto_suite } = req.body;

  if (!encrypted_content) {
    return res.status(400).json({ error: 'encrypted_content is required' });
  }

  try {
    const memberCheck = await pool.query(
      `SELECT 1 FROM conversation_members 
       WHERE conversation_id = $1 AND user_id = $2`,
      [conversationId, req.user.id]
    );

    if (!memberCheck.rows[0]) {
      return res.status(403).json({ error: 'Not a member of this conversation' });
    }

    const result = await pool.query(
      `INSERT INTO messages (
        conversation_id,
        sender_id,
        encrypted_content,
        recipient_key_id,
        sender_ephemeral_pubkey,
        crypto_suite
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, sent_at`,
      [
        conversationId,
        req.user.id,
        encrypted_content,
        recipient_key_id || null,
        sender_ephemeral_pubkey || null,
        crypto_suite || 'x25519+aesgcm'
      ]
    );

    const message = result.rows[0];

    return res.status(201).json({
      message_id: message.id,
      sent_at: message.sent_at
    });

  } catch (err) {
    console.error('[send message]', err.message);
    return res.status(500).json({ error: 'Failed to send message' });
  }
});


// fetch messages
router.get('/:conversationId/messages', authMiddleware, async (req, res) => {
  const { conversationId } = req.params;
  const { cursor, limit = 20 } = req.query;

  const parsedLimit = Math.min(parseInt(limit) || 20, 50);

  try {
    const memberCheck = await pool.query(
      `SELECT 1 FROM conversation_members
       WHERE conversation_id = $1 AND user_id = $2`,
      [conversationId, req.user.id]
    );

    if (!memberCheck.rows[0]) {
      return res.status(403).json({ error: 'Not a member of this conversation' });
    }

    const readResult = await pool.query(
    `SELECT user_id, last_read_message_id 
    FROM conversation_members
    WHERE conversation_id = $1 AND user_id != $2`,
    [conversationId, req.user.id]
    );

    const otherLastReadMessageId = readResult.rows[0]?.last_read_message_id || null;

    let result;

    if (cursor) {
      const [cursorTime, cursorId] = cursor.split('_');

      if (!cursorTime || !cursorId) {
        return res.status(400).json({ error: 'Invalid cursor format' });
      }

      result = await pool.query(
        `SELECT 
          id,
          sender_id,
          encrypted_content,
          recipient_key_id,
          sender_ephemeral_pubkey,
          crypto_suite,
          sent_at
        FROM messages
        WHERE conversation_id = $1
          AND is_deleted = false
          AND (sent_at, id) < ($2::timestamptz, $3::uuid)
        ORDER BY sent_at DESC, id DESC
        LIMIT $4`,
        [conversationId, cursorTime, cursorId, parsedLimit]
      );
    } else {
      result = await pool.query(
        `SELECT
          id,
          sender_id,
          encrypted_content,
          recipient_key_id,
          sender_ephemeral_pubkey,
          crypto_suite,
          sent_at
        FROM messages
        WHERE conversation_id = $1
          AND is_deleted = false
        ORDER BY sent_at DESC, id DESC
        LIMIT $2`,
        [conversationId, parsedLimit]
      );
    }

    const messages = result.rows;

    const nextCursor = messages.length === parsedLimit
      ? `${messages.at(-1).sent_at.toISOString()}_${messages.at(-1).id}`
      : null;

    return res.json({ 
      messages, 
      next_cursor: nextCursor,
      other_last_read_message_id: otherLastReadMessageId
    });

  } catch (err) {
    console.error('[fetch messages]', err.message);
    return res.status(500).json({ error: 'Failed to fetch messages' });
  }
});


// mark as read
router.post('/:conversationId/read', authMiddleware, async (req, res) => {
  const { conversationId } = req.params;
  const { last_read_message_id } = req.body;

  if (!last_read_message_id) {
    return res.status(400).json({ error: 'last_read_message_id is required' });
  }

  try {
    const memberCheck = await pool.query(
      `SELECT 1 FROM conversation_members
       WHERE conversation_id = $1 AND user_id = $2`,
      [conversationId, req.user.id]
    );

    if (!memberCheck.rows[0]) {
      return res.status(403).json({ error: 'Not a member of this conversation' });
    }

    const messageCheck = await pool.query(
      `SELECT 1 FROM messages
       WHERE id = $1 AND conversation_id = $2 AND is_deleted = false`,
      [last_read_message_id, conversationId]
    );

    if (!messageCheck.rows[0]) {
      return res.status(404).json({ error: 'Message not found in this conversation' });
    }

    await pool.query(
      `UPDATE conversation_members
       SET last_read_message_id = $1,
           last_read_at = NOW()
       WHERE conversation_id = $2 AND user_id = $3`,
      [last_read_message_id, conversationId, req.user.id]
    );

    return res.json({ ok: true });

  } catch (err) {
    console.error('[mark read]', err.message);
    return res.status(500).json({ error: 'Failed to mark as read' });
  }
});

module.exports = router;

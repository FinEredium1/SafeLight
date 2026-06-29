const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

router.get('/', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, username, current_key_id FROM users WHERE id = $1`,
      [req.user.id]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json(result.rows[0]);

  } catch (err) {
    console.error('[me]', err.message);
    return res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// ----------------------------------------------------------------------------
// Encrypted private-key backup ("key vault").
// The stored `bundle` is opaque to the server: it is the user's identity
// private key wrapped with a password-derived key on the client. The server
// only persists and returns the blob; it can never decrypt it.
// Requires migration: migrations/002_key_vault.sql
// ----------------------------------------------------------------------------

// Fetch my encrypted key bundle (used by a new device to restore keys).
router.get('/keyvault', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT bundle FROM user_key_vault WHERE user_id = $1`,
      [req.user.id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ error: 'No key vault for this user' });
    }
    return res.json({ bundle: result.rows[0].bundle });
  } catch (err) {
    console.error('[keyvault get]', err.message);
    return res.status(500).json({ error: 'Failed to fetch key vault' });
  }
});

// Store / replace my encrypted key bundle (on registration or key rotation).
router.put('/keyvault', authMiddleware, async (req, res) => {
  const { bundle } = req.body;

  // Minimal opaque-blob validation. The server must NOT inspect contents.
  if (!bundle || typeof bundle !== 'object' || !bundle.ct || !bundle.salt || !bundle.iv) {
    return res.status(400).json({ error: 'bundle (with ct, salt, iv) is required' });
  }

  try {
    await pool.query(
      `INSERT INTO user_key_vault (user_id, bundle, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET bundle = EXCLUDED.bundle, updated_at = NOW()`,
      [req.user.id, bundle]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error('[keyvault put]', err.message);
    return res.status(500).json({ error: 'Failed to store key vault' });
  }
});

module.exports = router;
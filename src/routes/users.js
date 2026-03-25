const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

router.get('/by-username/:username/public-key', authMiddleware, async (req, res) => {
  const { username } = req.params;

  try {
    const result = await pool.query(`
      SELECT 
        u.id         AS user_id,
        u.username,
        upk.key_id,
        upk.public_key
      FROM users u
      JOIN user_public_keys upk
        ON  upk.user_id = u.id
        AND upk.key_id  = u.current_key_id
      WHERE u.username      = $1
        AND u.is_system     = false
        AND upk.is_active   = true
        AND upk.revoked_at  IS NULL
    `, [username]);

    if (!result.rows[0]) {
      return res.status(404).json({ error: 'User not found or has no active key' });
    }

    return res.json(result.rows[0]);

  } catch (err) {
    console.error('[public-key lookup]', err.message);
    return res.status(500).json({ error: 'Failed to fetch public key' });
  }
});

module.exports = router;
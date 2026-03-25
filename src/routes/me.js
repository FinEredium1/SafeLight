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

module.exports = router;
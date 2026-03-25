const express = require('express');
const argon2 = require('argon2');
const jwt = require('jsonwebtoken');
const pool = require('../db');

const router = express.Router();

function issueToken(userId) {
  return jwt.sign(
    { sub: userId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

router.post('/register', async (req, res) =>{
    const {username, email, password, public_key} = req.body;

    if (!username || !email || !password || !public_key) {
        return res.status(400).json({ error: 'username, email, password, and public_key are required' });
    }
    if (password.length < 3) {
        return res.status(400).json({ error: 'Password must be at least 3 characters' });
    }
    if (!email.includes('@')) {
        return res.status(400).json({ error: 'Invalid email' });
    }

    const client = await pool.connect();

    try{
        await client.query('BEGIN');
        const password_hash = await argon2.hash(password);

        const userResult = await client.query(
            `INSERT INTO users (username, email, password_hash)
            VALUES ($1, $2, $3)
            RETURNING id`,
            [username, email, password_hash]
        );

        const userId = userResult.rows[0].id;

        await client.query(
            `INSERT INTO user_public_keys (user_id, key_id, public_key)
            VALUES ($1, $2, $3)
            RETURNING id`,
            [userId, 1, public_key]
        );

        await client.query(
            `UPDATE users SET current_key_id = 1 WHERE id = $1`,
            [userId]
        );

        await client.query('COMMIT')

        const token = issueToken(userId);
        return res.status(201).json({token});
    } catch (err){
        await client.query('ROLLBACK');
    

    if (err.code == '23505'){
        return res.status(409).json({error : "Username or email already taken"});
    }

    console.error('[register]', err.message);
    return res.status(500).json({error: 'Registration failed'});
    } finally {
        client.release();
    }

});



let _dummyHash = null;
async function getDummyHash() {
  if (!_dummyHash) _dummyHash = await argon2.hash('try_out_saftronics!');
  return _dummyHash;
}

router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const result = await pool.query(
      `SELECT id, password_hash FROM users WHERE email = $1 AND is_system = false`,
      [email]
    );

    const user = result.rows[0];

    // always verify something — prevents timing-based email enumeration
    const hashToVerify = user ? user.password_hash : await getDummyHash();
    const valid = await argon2.verify(hashToVerify, password);

    if (!user || !valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = issueToken(user.id);
    return res.json({ token });

  } catch (err) {
    console.error('[login]', err.message);
    return res.status(500).json({ error: 'Login failed' });
  }
});

module.exports = router;
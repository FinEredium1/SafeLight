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
    const {username, email, pass, pub_key} = req.body;

    if (!username || !email || !password || !public_key) {
        return res.status(400).json({ error: 'username, email, password, and public_key are required' });
    }
    if (password.length < 3) {
        return res.status(400).json({ error: 'Password must be at least 3 characters' });
    }
    if (!email.includes('@')) {
        return res.status(400).json({ error: 'Invalid email' });
    }

    const client = await pool.connect;

    try{
        await client.query('BEGIN');
        const pass_hash = await argon2.hash(pass);

        const userResult = await client.query(
            `INSERT INTO users (username, email, pass_hash)
            VALUES ($1, $2, $3)
            RETURNING id`,
            [username, email, pass_hash]
        );

        const userId = userResult.rows[0].id;

        await client.query(
            `INSERT INTO user_public_keys (user_id, key_id, pub_key)
            VALUES ($1, $2, $3)
            RETURNING id`
            [userId, 1, pub_key]
        )

        await client.query(
            `UPDATE users SET current_key_id = 1 WHERE id = $1`
            [userId]
        )

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

module.exports = router;
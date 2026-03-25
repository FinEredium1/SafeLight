const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const express = require('express');
const app = express();

app.use(express.json());

require('./db'); // connects on startup

const authRoutes = require('./routes/authen');
const meRoutes  = require('./routes/me');

app.use('/auth', authRoutes);
app.use('/me',   meRoutes);

app.get('/health', async (req, res) => {
  try {
    const pool = require('./db');
    const r = await pool.query('SELECT 1 AS ok');
    res.json({ status: 'ok', db_ok: r.rows?.[0]?.ok === 1 });
  } catch (e) {
    res.status(500).json({ status: 'error', db_error: String(e.message || e) });
  }
});

const port = Number(process.env.PORT || 8080);
app.listen(port, '0.0.0.0', () => {
  console.log(`Server listening on http://localhost:${port}`);
});
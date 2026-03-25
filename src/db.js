const {Pool} = require('pg');

if (!process.env.DATABASE_URL) {
  console.error("Missing DATABASE_URL in environment");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false,
});

pool.query('SELECT 1').then(() => {
  console.log('[db] Connected');
}).catch((err) => {
  console.error('[db] Connection failed:', err.message);
  process.exit(1);
});

module.exports = pool;
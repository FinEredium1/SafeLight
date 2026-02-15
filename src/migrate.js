const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Client } = require('pg');
const fs = require('fs');

async function migrate() {
    const client = new Client({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    try {
        await client.connect();
        console.log('✅ Connected to Neon');
        
        const schema = fs.readFileSync(path.join(__dirname, '..', 'schema_p.sql'), 'utf8');
        await client.query(schema);
        
        console.log('✅ Database schema created!');
    } catch (error) {
        console.error('❌ Migration failed:', error);
    } finally {
        await client.end();
    }
}

migrate();
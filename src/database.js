import 'dotenv/config';
import pg from 'pg';

const { Pool, Client } = pg;

const pool = new Pool({
    connectionString: process.env.DB_URL,
    ssl: {
        rejectUnauthorized: false
    },
    max: 20
});

// Listener error pool agar error koneksi background tidak menjadi uncaught exception
pool.on('error', (err) => {
    console.error('[DATABASE POOL ERROR]', err.message);
});

export { pool, Client };
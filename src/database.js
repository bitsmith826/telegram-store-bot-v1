import 'dotenv/config';
import pg from 'pg';

const { Pool, Client } = pg;

// Bypass DNS resolver Pterodactyl untuk mencegah error getaddrinfo EAI_AGAIN
let connectionString = process.env.DB_URL;
if (connectionString && connectionString.includes('aws-0-ap-southeast-1.pooler.supabase.com')) {
    connectionString = connectionString.replace(
        'aws-0-ap-southeast-1.pooler.supabase.com',
        '54.255.219.82'
    );
}

const pool = new Pool({
    connectionString: connectionString,
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
import pg from 'pg';
const { Pool, Client } = pg

const pool = new Pool({
    connectionString: process.env.DB_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

export { pool }
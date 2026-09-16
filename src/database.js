import dns from 'dns';
import pg from 'pg';

// Utamakan IPv4 untuk resolusi domain (mengatasi masalah IPv6 timeout pada VPS/container)
if (dns.setDefaultResultOrder) {
    dns.setDefaultResultOrder('ipv4first');
}

// Gunakan DNS server terpercaya (Google & Cloudflare) jika DNS lokal bermasalah
try {
    dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
} catch (e) {
    // Abaikan jika env melarang custom DNS
}

const { Pool, Client } = pg;

const pool = new Pool({
    connectionString: process.env.DB_URL,
    ssl: {
        rejectUnauthorized: false
    },
    max: 20,                          // Batas koneksi simultan pool
    connectionTimeoutMillis: 5000,    // Gagal cepat dalam 5 detik jika koneksi/DNS macet (mencegah bot hang)
    idleTimeoutMillis: 30000,         // Bersihkan koneksi nganggur setelah 30 detik
    statement_timeout: 10000          // Batalkan query jika tertahan > 10 detik
});

// Listener error pool agar error koneksi background tidak menjadi uncaught exception
pool.on('error', (err) => {
    console.error('[DATABASE POOL ERROR]', err.message);
});

export { pool, Client };
import dns from 'dns';
import pg from 'pg';

// Utamakan IPv4 agar menghindari masalah timeout IPv6 pada container/VPS
if (dns.setDefaultResultOrder) {
    dns.setDefaultResultOrder('ipv4first');
}

// ======================= IN-MEMORY DNS CACHING =======================
// Menyimpan IP Supabase di RAM selama 5 menit untuk mencegah error getaddrinfo EAI_AGAIN
const dnsCache = new Map();
const originalLookup = dns.lookup;

dns.lookup = function (hostname, options, callback) {
    let opts = options;
    let cb = callback;

    if (typeof opts === 'function') {
        cb = opts;
        opts = {};
    } else if (typeof opts === 'number') {
        opts = { family: opts };
    } else if (!opts) {
        opts = {};
    }

    const now = Date.now();
    const cached = dnsCache.get(hostname);

    // Jika alamat IP sudah tersimpan dan umurnya < 5 menit, langsung gunakan dari RAM
    if (cached && (now - cached.timestamp < 300000)) {
        if (opts.all) {
            return process.nextTick(() => cb(null, [{ address: cached.address, family: cached.family }]));
        }
        return process.nextTick(() => cb(null, cached.address, cached.family));
    }

    // Jika belum ada di cache atau sudah > 5 menit, panggil lookup asli
    originalLookup(hostname, opts, (err, address, family) => {
        if (!err && address) {
            const singleAddr = Array.isArray(address) ? address[0].address : address;
            const singleFam = Array.isArray(address) ? address[0].family : (family || 4);
            dnsCache.set(hostname, { address: singleAddr, family: singleFam, timestamp: now });
        } else if (err && cached) {
            // JIKA SERVER DNS PTERODACTYL TIMEOUT (EAI_AGAIN), PAKAI IP CACHE SEBAGAI PENYELAMAT!
            console.warn(`[DNS RESCUE] DNS resolver error (${err.code}). Menggunakan IP cache untuk: ${hostname}`);
            if (opts.all) {
                return process.nextTick(() => cb(null, [{ address: cached.address, family: cached.family }]));
            }
            return process.nextTick(() => cb(null, cached.address, cached.family));
        }
        cb(err, address, family);
    });
};
// ====================================================================

const { Pool, Client } = pg;

const pool = new Pool({
    connectionString: process.env.DB_URL,
    ssl: {
        rejectUnauthorized: false
    },
    max: 20,
    keepAlive: true,                      // Jaga koneksi TCP tetap hidup dengan heartbeat
    keepAliveInitialDelayMillis: 10000    // Kirim heartbeat TCP setiap 10 detik agar socket tidak diputus
});

// Listener error pool agar error koneksi background tidak menjadi uncaught exception
pool.on('error', (err) => {
    console.error('[DATABASE POOL ERROR]', err.message);
});

export { pool, Client };
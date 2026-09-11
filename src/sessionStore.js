import { pool } from './database.js';

// Session store custom untuk Telegraf, disimpan di tabel Supabase (bot_sessions)
// supaya session TIDAK hilang setiap kali bot di-restart/redeploy/crash.
// Sebelumnya Telegraf pakai default in-memory store bawaan, jadi semua state
// (list produk yang lagi dilihat user, progress admin nambah produk/stok, dll)
// hilang total tiap kali proses Node.js restart.
//
// PENTING: jalankan SQL berikut dulu di Supabase (SQL Editor) sebelum deploy:
//
// CREATE TABLE IF NOT EXISTS bot_sessions (
//     session_key TEXT PRIMARY KEY,
//     data JSONB NOT NULL DEFAULT '{}'::jsonb,
//     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
// );

export const pgSessionStore = {
    async get(key) {
        try {
            const result = await pool.query(
                `SELECT data FROM bot_sessions WHERE session_key = $1`,
                [key]
            );

            if (result.rows.length === 0) {
                return undefined;
            }

            return result.rows[0].data;
        } catch (e) {
            console.error('[SESSION] Gagal mengambil session:', e.message);
            return undefined;
        }
    },

    async set(key, value) {
        try {
            if (value === undefined || value === null) {
                return await this.delete(key);
            }
            await pool.query(
                `INSERT INTO bot_sessions (session_key, data, updated_at)
                 VALUES ($1, $2::jsonb, NOW())
                 ON CONFLICT (session_key)
                 DO UPDATE SET data = $2::jsonb, updated_at = NOW()`,
                [key, JSON.stringify(value)]
            );
        } catch (e) {
            console.error('[SESSION] Gagal menyimpan session:', e.message);
        }
    },

    async delete(key) {
        try {
            await pool.query(
                `DELETE FROM bot_sessions WHERE session_key = $1`,
                [key]
            );
        } catch (e) {
            console.error('[SESSION] Gagal menghapus session:', e.message);
        }
    }
};
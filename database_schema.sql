-- ====================================================================
-- DIGITAL STORE - DATABASE SCHEMA (PostgreSQL / Supabase)
-- Single Source of Truth untuk Web Store & Bot Telegram
-- ====================================================================

-- 1. TABEL: USERS
-- Menyimpan identitas pelanggan dari Bot Telegram maupun Web Store.
CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    telegram_id BIGINT NOT NULL UNIQUE, -- ID Telegram asli (angka positif) atau ID unik Web (angka negatif acak)
    username VARCHAR(255),               -- Username Telegram atau Email pembeli web
    first_name VARCHAR(255),             -- Nama depan Telegram atau nama pembeli
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);


-- 2. TABEL: PRODUCTS
-- Katalog produk & aplikasi premium yang dijual.
CREATE TABLE IF NOT EXISTS products (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,          -- Nama produk (contoh: "Canva Edu Lifetime", "Netflix 1 Bulan - 1P1U")
    description TEXT,                    -- Deskripsi produk & keunggulan
    price BIGINT NOT NULL,               -- Harga satuan dalam Rupiah (misal: 25000)
    note TEXT,                           -- Catatan panduan garansi & login (ditampilkan setelah bayar)
    active BOOLEAN DEFAULT TRUE,         -- Status produk (true = tampil, false = sembunyikan)
    created_at TIMESTAMPTZ DEFAULT NOW()
);


-- 3. TABEL: STOCKS
-- Gudang penyimpanan akun digital siap kirim.
CREATE TABLE IF NOT EXISTS stocks (
    id BIGSERIAL PRIMARY KEY,
    product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    account_data TEXT NOT NULL,          -- Format: email:password atau link invite
    status VARCHAR(50) DEFAULT 'available', -- 'available' = siap jual, 'sold' = terjual
    created_at TIMESTAMPTZ DEFAULT NOW(),
    sold_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_stocks_product_status ON stocks(product_id, status);


-- 4. TABEL: ORDERS
-- Pencatatan seluruh transaksi pembelian (Web & Telegram Bot).
CREATE TABLE IF NOT EXISTS orders (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    amount BIGINT NOT NULL,              -- Harga dasar (price * quantity)
    quantity INTEGER NOT NULL DEFAULT 1, -- Jumlah akun yang dibeli
    total BIGINT NOT NULL DEFAULT 0,     -- Total bayar (termasuk kode unik / fee gateway)
    payment_reference VARCHAR(100) UNIQUE, -- Deposit ID dari RamaShop (misal: RS-DEP-XXXX)
    status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'paid', 'completed', 'expired', 'cancelled'
    data TEXT,                           -- Data akun yang diserahkan ke pembeli
    message_id BIGINT,                   -- ID pesan chat di Telegram (untuk bot)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,              -- Batas waktu 15 menit dari QRIS
    paid_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_orders_payment_ref ON orders(payment_reference);
CREATE INDEX IF NOT EXISTS idx_orders_status_expires ON orders(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);


-- 5. TABEL: BOT_SESSIONS
-- Digunakan oleh framework Bot Telegram (Telegraf session storage).
CREATE TABLE IF NOT EXISTS bot_sessions (
    session_key TEXT PRIMARY KEY,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ====================================================================
-- CONTOH DATA AWAL (SEED PRODUCTS) - OPSIONAL
-- Uncomment baris di bawah jika ingin menambahkan produk awalan:
-- ====================================================================
/*
INSERT INTO products (name, description, price, note, active) VALUES
('Canva Edu Lifetime', 'Canva Edu Lifetime Garansi 3 Bulan', 3000, 'Format: email invite | Klaim garansi hubungi CS', true),
('Viu Premium Lifetime', 'Viu Private Lifetime. All Device. Garansi 2 Bulan.', 2500, 'Format: nomorhp|password\nTutorial Login: https://youtube.com/shorts/0Udd_MQXbfk', true),
('Alight Motion 1 Tahun', 'Alight Motion Private 1 Tahun. All Device. Garansi 1 Bulan.', 500, 'Format: email|password', true)
ON CONFLICT DO NOTHING;
*/

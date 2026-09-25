# 🤖 Digital Store - Telegram Store Bot

Bot Telegram otomatis 24 jam nonstop untuk penjualan akun & produk digital premium (Netflix, Spotify, Canva, CapCut, YouTube, dll).

Terhubung langsung dengan **PostgreSQL Supabase (Berbagi 1 Database dengan Web Store)** dan **Payment Gateway QRIS NovaPay**.

---

## ✨ Fitur-Fitur Unggulan

### 1. ⚡ Transaksi & Pembayaran QRIS Otomatis
- **QR Code Composite Engine (Sharp & QRCode):** Menggabungkan string QRIS EMVCo langsung ke dalam template banner resmi toko (`assets/qris_template.jpg`) menggunakan modul biner `sharp` beresolusi 1024x1024, sehingga foto QRIS yang dikirim ke chat Telegram sangat estetik, beresolusi tinggi, dan rapi.
- **Counter Keyboard Interaktif:** Tombol `-`, `+`, dan jumlah akun interaktif langsung di chat saat pembeli ingin beli lebih dari 1 akun.
- **Pendeteksi Brand & Variasi Cerdas (`detectBrand`):** Memisahkan nama brand utama dengan variasi durasi paket secara otomatis pada tombol navigasi.
- **Penyerahan Akun Instan:** Status pembayaran dicek secara real-time. Begitu pembayaran terkonfirmasi lunas, akun digital (`email:password` / link invite) langsung dikirimkan ke chat pembeli secara instan.

### 2. 🔄 Background Cron Jobs Real-Time (Daemon Otomatis)
- **Auto-Detect Pembayaran (Tiap 3 Detik):** Bot memeriksa status pembayaran order pending dan cancelled ke gateway NovaPay setiap 3 detik.
- **Auto-Retry Akun Paid (Tiap 3 Detik):** Menjamin tidak ada transaksi berstatus paid yang tertunda penyerahan akunnya.
- **Auto-Cleanup Order Expired (Tiap 5 Detik):** Pesanan pending yang melewati batas 15 menit otomatis diubah menjadi `expired`, stok dikembalikan ke gudang (*auto-restored*), pesan chat diupdate, dan notifikasi kedaluwarsa dikirim ke channel monitoring.
- **Auto-Clean Sesi Database (Tiap Minggu Jam 03:00):** Membersihkan data sesi lama di tabel `bot_sessions` yang berusia > 7 hari agar database PostgreSQL tidak membengkak.
- **Anti Race-Condition (`orderSedangDiproses`):** Proteksi memori internal agar tidak terjadi pengiriman akun ganda saat dua proses berjalan bersamaan.

### 3. 🗄️ Sinkronisasi Database Terpusat (Web & Bot)
- Berbagi tabel `products`, `stocks`, `orders`, `users`, dan `bot_sessions` yang sama dengan Web Store.
- Pengurangan stok akun bersifat terpusat dan *real-time*. Pembelian di bot otomatis mengurangi stok di web, dan sebaliknya.
- Mencegah *overselling* dengan logika *Effective Stock*.

### 4. 👤 Layanan Mandiri Pengguna (Pembeli)
- **Katalog & Smart Pagination:** Menampilkan produk dengan pembagian halaman otomatis (`<<`, `1/2`, `>>`) jika produk melebihi `ITEM_PER_HALAMAN` (6 produk per halaman) agar chat tidak kepanjangan.
- **Riwayat Pesanan (`/order`):** Melihat seluruh transaksi masa lalu, nomor referensi transaksi, status, dan data akun yang pernah dibeli.
- **Profil Pembeli (`/me`):** Menampilkan ID Telegram, nama, username, dan total pesanan berhasil.

### 5. 🛠️ Panel Kontrol Admin Lengkap (`/admin`)
- **Kelola Produk:**
  - Tambah produk baru langsung lewat chat.
  - Ubah harga, nama, deskripsi, dan catatan garansi/note.
  - Sembunyikan (nonaktifkan) produk.
- **Kelola Stok Akun:**
  - **Tambah Stok Massal (Bulk Upload):** Input banyak akun sekaligus dalam format multi-baris `email:password`.
  - **Ambil Stok:** Tarik dan lihat daftar stok akun yang masih tersedia di database.
  - **Hapus Stok:** Hapus akun tertentu dari gudang stok.
- **Broadcast Massal:** Kirim pesan siaran/promosi ke seluruh pengguna bot secara serentak.
- **Kelola User:** Melihat total pelanggan yang terdaftar di database.
- **Diagnostik Sistem:**
  - `/dbtest`: Menguji koneksi database PostgreSQL Supabase (`SELECT NOW()`).
  - `/pgtest`: Menguji koneksi API Key payment gateway NovaPay dengan simulasi deposit Rp 1.000.

### 6. 📢 Channel Monitoring Real-Time
- Mengirim notifikasi transaksi ke Channel Monitoring Telegram untuk 4 status:
  - ⏳ `MENUNGGU PAYMENT`
  - ✅ `SUKSES`
  - ❌ `KADALUARSA`
  - 🚫 `DIBATALKAN`

---

## ⌨️ Panduan Command (Perintah Bot)

### 👤 Perintah untuk Pengguna (Pembeli):
| Command | Deskripsi |
| :--- | :--- |
| `/start` | Membuka menu utama bot, navigasi belanja, dan tombol bantuan |
| `/stok` | Menampilkan katalog produk, harga, dan sisa stok aktif secara real-time |
| `/order` | Melihat riwayat transaksi dan data akun yang pernah dibeli |
| `/me` | Menampilkan profil Telegram pembeli (ID, nama, & riwayat belanja) |

### 👑 Perintah Khusus Admin / Owner:
*(Hanya dapat diakses oleh Telegram User ID yang terdaftar di `USER_ID_ADMIN`)*

| Command | Deskripsi |
| :--- | :--- |
| `/admin` | Membuka dashboard panel kendali admin interaktif (Kelola Produk, Stok, User, Broadcast) |
| `/dbtest` | **Tes Koneksi Database:** Menguji apakah bot berhasil terhubung ke PostgreSQL / Supabase (`SELECT NOW()`) |
| `/pgtest` | **Tes Payment Gateway:** Menguji koneksi API Key NovaPay QRIS dengan simulasi deposit Rp 1.000 |

---

## 🚀 Panduan Instalasi & Menjalankan

1. **Clone repositori:**
   ```bash
   git clone https://github.com/USERNAME/REPO_BOT.git
   cd REPO_BOT
   ```

2. **Install Dependensi:**
   ```bash
   npm install
   ```

3. **Setup Database (Supabase / PostgreSQL):**
   - Buka **[Supabase](https://supabase.com)** dan login / buat akun.
   - Klik **New Project**, tentukan nama project, buat **Database Password** (catat password ini!), dan pilih Region terdekat (contoh: *Singapore*).
   - Masuk ke menu **SQL Editor** di sidebar kiri (ikon `>_`).
   - Klik **New query**, lalu salin seluruh isi file `database_schema.sql`, tempelkan ke SQL Editor, lalu klik tombol **Run**.
   - *(Jika Anda sudah menjalankan schema ini untuk Web Store, lewati langkah ini karena keduanya memakai database yang sama).*

4. **Setup Konfigurasi Environment:**
   Salin `.env.example` menjadi `.env`:
   ```bash
   cp .env.example .env
   ```

   #### 🔑 Panduan Mendapatkan API Key & Token:
   - **`BOT_TOKEN` (Token Bot Telegram):**
     1. Chat bot resmi [@BotFather](https://t.me/BotFather) di Telegram.
     2. Ketik `/newbot` dan ikuti instruksi hingga mendapatkan HTTP API token.
   - **`USER_ID_ADMIN` (ID Telegram Admin/Owner):**
     1. Chat bot [@userinfobot](https://t.me/userinfobot) di Telegram.
     2. Ketik `/start` untuk melihat ID Telegram Anda (berupa angka positif).
   - **`USER_ID_CHANNEL` (Channel Monitoring):**
     1. Buat Channel Telegram baru dan tambahkan bot Anda sebagai **Administrator**.
     2. Forward pesan dari channel tersebut ke [@userinfobot](https://t.me/userinfobot) untuk mendapatkan ID Channel (berawalan `-100...`).
   - **`API_KEY_PG` (Payment Gateway QRIS NovaPay):**
     1. Buka situs resmi **[novpay.id](https://novpay.id)** dan lakukan registrasi akun (atau login jika sudah punya).
        > 💡 **Token Aktivasi Pendaftaran:** Jika pendaftaran meminta token aktivasi, Anda bisa memintanya secara **GRATIS** ke owner NovaPay di Telegram: [@xNovalune](https://t.me/xNovalune) (Channel Resmi: [@novapayinfo](https://t.me/novapayinfo)).
     2. Masuk ke **Dashboard NovaPay** > lengkapi profil toko/merchant serta nomor rekening / e-wallet penarikan (*Settlement*).
     3. Buka menu **Integrasi API** / **Developer** / **API Keys**.
     4. Klik tombol **Buat API Key Baru** (*Generate API Key*).
     5. Salin string API Key yang dihasilkan (diawali dengan awalan `nvp_...`, contoh: `nvp_8e45c301cdadd8a8c2caf...`).
     6. Tempelkan nilai tersebut ke variabel `API_KEY_PG` di file `.env`.
     7. *(Diagnostik)*: Setelah bot dijalankan, kirim command `/pgtest` di chat Telegram untuk memastikan bot terhubung sukses ke NovaPay.
   - **`DB_URL` (Database PostgreSQL Supabase):**
     1. Buka dashboard project Anda di **[Supabase](https://supabase.com)**.
     2. Klik tombol **Connect** di bagian header atas (atau buka menu **Project Settings** ⚙️ di pojok kiri bawah > **Database**).
     3. Pada bagian **Connection string**, pilih tab **URI**.
     4. Pilih mode **Session (Port 5432)** atau Direct Connection.
     5. Salin URL yang tampil, contoh:
        ```text
        postgresql://postgres.[PROJECT_REF]:[YOUR-PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
        ```
     6. **PENTING:** Ganti tulisan `[YOUR-PASSWORD]` di dalam URL tersebut dengan password database yang Anda buat di langkah 3 *(jika lupa password, klik tombol "Reset database password" di halaman tersebut)*.
     7. *Tips VPS/Hosting (Bypass DNS EAI_AGAIN):* Domain bawaan Supabase (`aws-0-[REGION].pooler.supabase.com`) adalah pilihan utama. Namun jika VPS Anda mengalami error resolver DNS (`EAI_AGAIN`) dan memilih region **Singapore (`ap-southeast-1`)**, Anda dapat mengganti host pooler dengan Direct IP AWS Singapore:
        ```text
        postgresql://postgres.[PROJECT_REF]:[PASSWORD]@54.255.219.82:5432/postgres
        ```

5. **Jalankan Bot:**
   ```bash
   npm start
   ```

6. **Lakukan Pengujian Diagnostik:**
   - Kirim `/dbtest` ke bot untuk menguji koneksi database Supabase.
   - Kirim `/pgtest` ke bot untuk menguji payment gateway NovaPay.

---

## ⚙️ Cara Registrasi Command di BotFather (Menu Tombol Telegram)
Agar command muncul otomatis saat pengguna mengetik tanda garis miring (`/`), daftarkan di [@BotFather](https://t.me/BotFather):
1. Buka [@BotFather](https://t.me/BotFather) > Ketik `/setcommands`.
2. Pilih bot Anda.
3. Tempelkan teks berikut:
   ```text
   start - Buka menu utama & katalog
   stok - Cek katalog & sisa stok produk
   order - Riwayat pesanan & akun saya
   me - Profil akun saya
   admin - Panel kontrol admin (Khusus Owner)
   dbtest - Tes koneksi database (Admin)
   pgtest - Tes payment gateway (Admin)
   ```

---

## 📄 Struktur Folder

```text
├── assets/                # Template banner QRIS 1024x1024
├── src/                   # Source code bot Telegram (bot.js, admin.js, dll)
├── .env.example           # Template konfigurasi environment
├── .gitignore             # File yang dikecualikan dari Git
├── database_schema.sql    # Skema DDL tabel database PostgreSQL/Supabase
├── package.json           # Dependensi & script start
└── README.md              # Dokumentasi resmi
```

---

## 🔒 Lisensi
Hak Cipta © 2026 **Vhee Store**.

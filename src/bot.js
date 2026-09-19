import 'dotenv/config';
import { Markup, session, Telegraf } from 'telegraf';
import { fmt, bold, italic, code } from 'telegraf/format';
import pg from 'pg';
import { pool } from './database.js';
import cron from 'node-cron';

// Matikan log warning berulang dari node-cron (seperti missed execution)
cron.setLogger({
    info: () => { },
    warn: () => { },
    error: (msg, err) => console.error('[CRON ERROR]', err || msg),
    debug: () => { }
});
import { buatPayment, cekPayment } from './paymentgateway.js';
import dns from 'dns';
// Paksa Node.js v17+ untuk mengutamakan IPv4 dibanding IPv6
dns.setDefaultResultOrder('ipv4first');
import { adminSetup } from './admin.js';
import { log } from 'console';
import { pgSessionStore } from './sessionStore.js';
import sharp from 'sharp';
import QRCode from 'qrcode';

// ======================== inisiasi bot ========================
const bot = new Telegraf(process.env.BOT_TOKEN)
bot.use(session({
    store: pgSessionStore, // session disimpan di Supabase (tabel bot_sessions), bukan cuma di memory
    defaultSession: () => ({}) // inisialiasi default {}
}));

const cooldown = new Map();
// Set untuk mencegah order yang sama diproses 2x oleh dua tick cron pengiriman yang overlap
// (misalnya karena proses kirim produk sedang berjalan lama > 3 detik).
const orderSedangDiproses = new Set();

bot.catch((err, ctx) => {
    console.error("[BOT ERROR]", err);

    ctx.reply("❌ Terjadi kesalahan sistem.").catch(() => { });
});
// ==============================================================

adminSetup(bot)

function waktuSekarang() {
    const now = new Date()
    const timeString = now.toLocaleTimeString('id-ID', {
        timeZone: 'Asia/Jakarta',
        timeZoneName: 'short'
    })

    return timeString
}

async function apaAdmin(ctx) {
    try {
        // Ambil string dari .env dan ubah jadi array ID
        const adminList = (process.env.USER_ID_ADMIN || '')
            .split(',')
            .map(id => id.trim());

        const userId = String(ctx.chat.id);

        if (!adminList.includes(userId)) {
            await ctx.reply("❌ Anda bukan admin...");
            return false;
        } else {
            return true;
        }
    } catch (error) {
        console.log("[ERROR] Gagal check admin", error.message);
        return false;
    }
}

async function checkUser(ctx) {
    // Pakai UPSERT atomik (satu query) supaya tidak ada celah race condition.
    // Sebelumnya pola "SELECT dulu, baru INSERT kalau kosong" bisa bikin error
    // duplicate key kalau ada 2 request nyaris bersamaan untuk user baru yang sama
    // (mengandalkan UNIQUE constraint users_telegram_id_key yang sudah ada di DB).
    // Sekalian update username/first_name kalau user ganti nama/username di Telegram.
    const userResult = await pool.query(`
        INSERT INTO users (
            telegram_id,
            username,
            first_name
        )
        VALUES ($1, $2, $3)
        ON CONFLICT (telegram_id)
        DO UPDATE SET
            username = EXCLUDED.username,
            first_name = EXCLUDED.first_name
        RETURNING id
    `, [
        ctx.chat.id,
        ctx.chat.username,
        ctx.chat.first_name
    ]);

    return userResult.rows[0].id
}

function formatTelegramLink(val) {
    if (!val) return 'https://t.me';
    if (val.startsWith('http://') || val.startsWith('https://')) return val;
    return `https://t.me/${val.replace(/^@/, '')}`;
}

async function sendNotifMonitoring(order) {
    try {
        if (!process.env.USER_ID_CHANNEL) return;

        const reff = String(order.reffid || '');
        const reffIdSensored = reff.length > 7
            ? reff.substring(0, 3) + "xxxxxxx" + reff.slice(-4)
            : (reff || "-");

        let iconStatus = '⏳';
        const st = String(order.status || '').toUpperCase();
        if (st.includes('SUKSES') || st.includes('SUCCESS') || st.includes('COMPLETED')) {
            iconStatus = '✅';
        } else if (st.includes('KADALUARSA') || st.includes('EXPIRED')) {
            iconStatus = '❌';
        } else if (st.includes('DIBATALKAN') || st.includes('CANCEL')) {
            iconStatus = '🚫';
        }

        const feeText = (order.fee !== undefined && order.fee !== null) ? ("🏷️ <b>Fee:</b> Rp. " + order.fee + "\n") : "";
        const textNotif =
            "🔔 <b>PAYMENT MONITORING (Bot Telegram)</b>\n" +
            "━━━━━━━━━━━━━━━━━━━━\n" +
            "📡 <b>Reff ID:</b> " + reffIdSensored + "\n" +
            "📦 <b>Produk:</b> " + order.name + "\n" +
            "💳 <b>Metode:</b> " + (order.metode || "QRIS") + "\n" +
            "💵 <b>Harga:</b> Rp. " + order.harga + "\n" +
            "🔢 <b>Jumlah:</b> " + order.jumlah + "\n" +
            feeText +
            "💸 <b>Total Bayar:</b> Rp. " + order.total + "\n" +
            "🌐 <b>Platform:</b> Bot Telegram\n" +
            "━━━━━━━━━━━━━━━━━━━━\n" +
            iconStatus + " <b>Status:</b> " + order.status;

        const channelUrl = formatTelegramLink(process.env.USERNAME_CHANNEL || '');
        const adminUrl = formatTelegramLink(process.env.USERNAME_TG_ADMIN || '');

        await bot.telegram.sendMessage(process.env.USER_ID_CHANNEL, textNotif,
            {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([
                    [Markup.button.url("📢 Official Channel", channelUrl)],
                    [Markup.button.url("💬 Customer Service", adminUrl)]
                ])
            }
        );
    } catch (err) {
        console.error("[MONITORING ERROR] Gagal kirim notif ke channel:", err.message);
    }
}


// ================================== tes koneksi ke database =====================================
bot.command(`dbtest`, async (ctx) => {
    try {
        const adminCek = await apaAdmin(ctx)
        if (adminCek) {
            const result = await pool.query("SELECT NOW()");
            if (!result) {
                return await ctx.reply("❌ Database gagal terhubung.");
            }
            await ctx.reply("✅ Database berhasil terhubung!");
        }
    } catch (e) {
        console.log("[ERROR] DBTEST", e.message);
    }
});
// =================================================================================================

// ================================== tes koneksi ke database =====================================
bot.command(`pgtest`, async (ctx) => {
    try {
        const adminCek = await apaAdmin(ctx)
        if (adminCek) {
            const result = await buatPayment(1000);
            await ctx.reply(`✅ Payment gateway berhasil terhubung!`, { parse_mode: "HTML" });
        }
    } catch (e) {
        console.log("[ERROR] PGTEST", e.message);
        const adminCek = await apaAdmin(ctx)
        if (adminCek) {
            await ctx.reply("❌ Payment gateway gagal terhubung.");
        }
    }
});
// =================================================================================================

// ===================================== halaman utama ==============================================
async function halamanUtama(ctx) {
    let username = process.env.USERNAME_TG_ADMIN

    if (username != "") {
        if (username.includes('@')) {
            username = username.replaceAll('@', '')
        }
    } else {
        username = "123"
    }

    try {
        const statistikResult = await pool.query(`
            SELECT 
                (SELECT COUNT(*) FROM users) AS total_user,
                COALESCE(SUM(quantity), 0) AS total_terjual,
                COALESCE(SUM(total), 0) AS total_transaksi
            FROM orders
            WHERE status = 'completed'
        `)

        const statistik = statistikResult.rows[0]
        console.log("[INFO]", ctx.chat.id, "sedang memulai bot")

        await ctx.replyWithPhoto(
            { source: "./assets/banner.png" },
            {
                caption: fmt`Halo ${bold`${ctx.chat?.first_name}`}. Selamat datang di ${bold`${process.env.NAMA_TOKO}`}.
                \n${process.env.DESKRIPSI_TOKO ? italic`${process.env.DESKRIPSI_TOKO}` : italic`Selamat berbelanja`}
                \n${bold`Statistik:`}\n┖ Total Terjual: ${statistik.total_terjual} pcs\n┖ Total User: ${statistik.total_user}
                \nSilakan pilih menu di bawah ini!`,
                ...Markup.inlineKeyboard([
                    [
                        Markup.button.callback("📦 Katalog", "katalog"),
                        Markup.button.callback("📊 Laporan Stok", "stok")
                    ],
                    [
                        Markup.button.callback("📋 Pesanan Saya", "orders"),
                        Markup.button.callback("👤 Profile Saya", "profile"),
                    ],
                    [
                        Markup.button.callback("❓ Cara Order", "caraorder"),
                        Markup.button.url("ℹ️ Bantuan", `https://t.me/${username}`)
                    ]
                ])
            }
        )
    } catch (e) {
        console.error(e.message)
    }
}

bot.start(async (ctx) => {
    if (ctx.session) {
        delete ctx.session.produk_list;
        delete ctx.session.grouped_products;
        delete ctx.session.viewed_prices;
    }
    await halamanUtama(ctx);
    await checkUser(ctx);
});

bot.command("start", async (ctx) => {
    if (ctx.session) {
        delete ctx.session.produk_list;
        delete ctx.session.grouped_products;
        delete ctx.session.viewed_prices;
    }
    await halamanUtama(ctx);
    await checkUser(ctx);
});
// =================================================================================================

// ============================================= halaman profile ====================================
async function halamanProfile(ctx) {
    try {
        const cekId = await pool.query(`
            SELECT id
            FROM users
            WHERE telegram_id = $1
        `, [ctx.chat.id])

        if (cekId.rows.length === 0) {
            return await ctx.reply("Anda tidak dikenali oleh bot dan database..")
        }

        const userid = cekId.rows[0].id
        // console.log(userid)

        const totalTx = await pool.query(`
            SELECT COUNT(*) AS totaltransaksi
            FROM orders
            WHERE user_id = $1;
        `, [userid])
        // console.log("Jumlah transaksi:", totalTx.rows[0])

        const totalPengeluaran = await pool.query(`
            SELECT COALESCE(SUM(amount), 0) AS totalpengeluaran
            FROM orders
            WHERE user_id = $1
            AND status = 'completed'
        `, [userid])
        // console.log("Total pengeluaran:", totalPengeluaran.rows[0])

        const text = [`╭──────────────────`,
            `│ <b>📄 Informasi Profil</b>`,
            `├──────────────────`,
            `│ ⬩ <b>User ID</b> : <code>${ctx.chat?.id}</code>`,
            `│ ⬩ <b>Username</b> : <code>@${ctx.chat?.username || '-'}</code>`,
            `│ ⬩ <b>Nama</b> : ${ctx.chat?.first_name || ''} ${ctx.chat?.last_name || ''}`,
            `│ ⬩ <b>Total Transaksi</b> : ${totalTx.rows[0].totaltransaksi}`,
            `│ ⬩ <b>Total Pengeluaran</b> : Rp ${Number(totalPengeluaran.rows[0].totalpengeluaran).toLocaleString('id-ID')}`,
            `╰──────────────────`
        ]

        const reply = await ctx.reply(text.join('\n'), {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard([Markup.button.callback("⬅️ Menu Utama", "backProfileUtama")])
        });

        if (!ctx.session) ctx.session = {};
        ctx.session.messageId_profile = reply.message_id;
    } catch (e) {
        console.error(e.message)
        await ctx.reply("Gagal mengambil informasi profil.");
    }
}

bot.action("profile", async (ctx) => {
    await ctx.answerCbQuery().catch(() => { })
    await ctx.deleteMessage().catch(() => { })
    await halamanProfile(ctx)
})

bot.command("me", async (ctx) => {
    await halamanProfile(ctx);
});

bot.action("backProfileUtama", async (ctx) => {
    try {
        await ctx.answerCbQuery().catch(() => { })
        await ctx.deleteMessage().catch(() => { })
        await halamanUtama(ctx)
        if (ctx.session) ctx.session.messageId_profile = null
    } catch (e) {
        console.error("[ERROR]", e.message)
    }
})
// ===============================================================================================

// ========================================== Riwayat Pesanan ======================================
async function halamanOrders(ctx) {
    try {
        console.log("[INFO]", ctx.chat.id, "sedang menampilkan riwayat pesanan")

        const resultPesanan = await pool.query(`
            SELECT 
                orders.payment_reference AS order_id,
                products.name AS product_name,
                orders.total,
                orders.quantity,
                orders.status,
                orders.created_at
            FROM orders
            JOIN products ON orders.product_id = products.id
            JOIN users ON orders.user_id = users.id
            WHERE users.telegram_id = $1
            ORDER BY orders.created_at DESC
            LIMIT 5;
        `, [ctx.chat.id])

        if (resultPesanan.rows.length === 0) {
            const text = [`╭──────────────────`,
                `│ <b>📋 Pesanan Saya</b>`,
                `│`,
                `│ <i>Riwayat 5 Transaksi Terakhir</i>`,
                `├──────────────────`,
                `│ Belum ada riwayat transaksi`,
                `╰──────────────────╯`
            ].join('\n')

            const reply = await ctx.reply(text, {
                parse_mode: "html",
                ...Markup.inlineKeyboard([Markup.button.callback("⬅️ Menu Utama", "backOrdersUtama")])
            })
            if (!ctx.session) ctx.session = {};
            ctx.session.messageId_orders = reply.message_id;
            return;
        }

        // Map status ke kata baru dengan huruf kapital di awal
        const statusMap = {
            pending: 'MENUNGGU PAYMENT',
            paid: 'TERBAYAR',
            completed: 'SUKSES',
            expired: 'KADALUARSA',
            cancelled: 'DIBATALKAN'
        };

        const orderList = resultPesanan.rows.map((row) => {
            const d = new Date(row.created_at)
            return [
                `│ <b>Produk:</b> <code>${row.product_name.toUpperCase()}</code>`,
                `│ <b>Reff ID:</b> <code>${row.order_id}</code>`,
                `│ <b>Jumlah:</b> ${row.quantity}`,
                `│ <b>Total:</b> Rp ${Number(row.total).toLocaleString('id-ID')}`,
                `│ <b>Status:</b> ${statusMap[row.status?.toLowerCase()] || row.status}`,
                `│ <b>Tgl/jam:</b> ${d.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Jakarta' })}, ${d.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: "2-digit", minute: "2-digit", hour12: false })} WIB`
            ].join('\n');
        }).join('\n├──────────────────\n');

        const text = [
            `╭──────────────────`,
            `│ <b>📋 Pesanan Saya</b>`,
            `│`,
            `│ <i>Riwayat 5 Transaksi Terakhir</i>`,
            `├──────────────────`,
            orderList,
            `╰──────────────────`
        ].join('\n');

        const reply = await ctx.reply(text,
            {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([Markup.button.callback("⬅️ Menu Utama", "backOrdersUtama")])
            }
        )

        if (!ctx.session) ctx.session = {};
        ctx.session.messageId_orders = reply.message_id
    } catch (e) {
        console.log(e.message)
    }
}

bot.action("orders", async (ctx) => {
    await ctx.answerCbQuery().catch(() => { })
    await ctx.deleteMessage().catch(() => { })
    await halamanOrders(ctx)
})

bot.command("order", async (ctx) => {
    await halamanOrders(ctx);
});

bot.action("backOrdersUtama", async (ctx) => {
    try {
        await ctx.answerCbQuery().catch(() => { })
        await ctx.deleteMessage().catch(() => { })
        await halamanUtama(ctx)
        if (ctx.session) ctx.session.messageId_orders = null
    } catch (e) {
        console.error("[ERROR]", e.message)
    }
})
// ===============================================================================================

// ========================================== halaman stok =======================================
async function halamanStok(ctx) {
    try {
        console.log("[INFO]", ctx.chat.id, "sedang menampilkan stok")

        const resultPesanan = await pool.query(`
            SELECT
                p.id AS product_id,
                p.name AS product_name,
                (SELECT COUNT(*) FROM stocks s WHERE s.product_id = p.id AND s.status = 'available') AS stok_tersedia,
                (SELECT COALESCE(SUM(o.quantity), 0) FROM orders o WHERE o.product_id = p.id AND o.status = 'pending' AND (o.expires_at > NOW() OR o.expires_at IS NULL)) AS stok_pending
            FROM products p
            WHERE p.active = TRUE
            ORDER BY p.name ASC
        `);

        if (resultPesanan.rows.length === 0) {
            const text = [`╭──────────────────`,
                `│ <b>📊 Laporan Stok</b>`,
                `├──────────────────`,
                `│ Belum ada produk`,
                `╰──────────────────╯`
            ].join('\n')

            const reply = await ctx.reply(text, {
                parse_mode: "html",
                ...Markup.inlineKeyboard([Markup.button.callback("⬅️ Menu Utama", "backStokUtama")])
            })
            if (!ctx.session) ctx.session = {};
            ctx.session.messageId_stok = reply.message_id;
            return;
        }

        let totalstoktersedia = 0;
        let stoklist = [];
        for (const [index, stok] of resultPesanan.rows.entries()) {
            const available = parseInt(stok.stok_tersedia, 10) || 0;
            const pending = parseInt(stok.stok_pending, 10) || 0;
            const stoktersedia = Math.max(0, available - pending);
            totalstoktersedia += stoktersedia;
            stoklist.push(`${index + 1}. ${stok.product_name.toUpperCase()} — (${stoktersedia})`);
        }

        ctx.session.stoklist = stoklist
        ctx.session.totalstoktersedia = totalstoktersedia
        const halamanMulai = 0;

        const reply = await ctx.reply(getPageTextStok(halamanMulai, stoklist, totalstoktersedia),
            {
                parse_mode: 'HTML',
                ...getPaginationKeyboardStok(halamanMulai, stoklist)
            }
        )
        ctx.session.messageId_stok = reply.message_id
    } catch (e) {
        console.log(e.message)
    }
}

// fungsi membuat dan memsiahkan text sesaui jumlah item per halaman
function getPageTextStok(page, dataList, totalstoktersedia) {
    const item_per_halaman = Number(process.env.ITEM_PER_HALAMAN)

    const start = page * item_per_halaman;
    const end = start + item_per_halaman;
    const items = dataList.slice(start, end);
    const totalPages = Math.ceil(dataList.length / item_per_halaman);

    const text = [
        `╭──────────────────`,
        `│ <b>📊 Laporan Stok</b>`,
        `│`,
        `│ <i>Nama produk — (stok)</i>`,
        `├──────────────────`,
        ...items.map(item => `│ ${item}`),
        `├──────────────────`,
        `│ <b>Total stok tersedia:</b> ${totalstoktersedia}`,
        `├──────────────────`,
        `│ 📄 Halaman: ${page + 1} / ${totalPages}`,
        `╰──────────────────`
    ].join('\n');

    return text;
}

// fungsi untuk membuat tombol Previous & Next
function getPaginationKeyboardStok(page, dataList) {
    const item_per_halaman = Number(process.env.ITEM_PER_HALAMAN)

    const buttons = [];
    const totalPages = Math.ceil(dataList.length / item_per_halaman);

    // Tombol Previous: Hanya muncul jika posisi halaman di atas 0 (bukan halaman pertama)
    if (page > 0) {
        buttons.push([Markup.button.callback('◀️ Sebelumnya', `goto_page_stok_${page - 1}`)]);
    }

    // Tombol Next: Hanya muncul jika posisi belum mencapai halaman terakhir
    if (page < totalPages - 1) {
        buttons.push([Markup.button.callback('▶️ Berikutnya', `goto_page_stok_${page + 1}`)]);
    }

    buttons.push([Markup.button.callback("⬅️ Menu Utama", "backStokUtama")])
    // Bungkus tombol di dalam baris array []
    return Markup.inlineKeyboard(buttons);
}

// ketika button ada dan diklik maka akan ada edit pesan list produk
bot.action(/goto_page_stok_(\d+)/, async (ctx) => {
    const targetPage = parseInt(ctx.match[1]);

    try {
        await ctx.answerCbQuery().catch(() => { })

        if (!ctx.session?.stoklist) {
            return await halamanStok(ctx);
        }

        await ctx.editMessageText(
            getPageTextStok(targetPage, ctx.session.stoklist, ctx.session.totalstoktersedia),
            {
                parse_mode: 'HTML',
                ...getPaginationKeyboardStok(targetPage, ctx.session.stoklist)
            }
        )
    } catch (error) {
        console.error('[ERROR] Gagal mengedit:', error.message);
    }
});

bot.action("stok", async (ctx) => {
    await ctx.answerCbQuery().catch(() => { })
    await ctx.deleteMessage().catch(() => { })
    await halamanStok(ctx)
})

bot.command("stok", async (ctx) => {
    await halamanStok(ctx);
});

bot.action("backStokUtama", async (ctx) => {
    try {
        await ctx.answerCbQuery().catch(() => { })
        await ctx.deleteMessage().catch(() => { })
        await halamanUtama(ctx)
        if (ctx.session) ctx.session.messageId_stok = null
    } catch (e) {
        console.error("[ERROR]", e.message)
    }
})
// ===============================================================================================

// =========================================== halaman help ======================================
// bot.action("help", async (ctx) => {
//     try {
//         await ctx.answerCbQuery().catch(() => {})
//         let username = process.env.USERNAME_TG_ADMIN

//         if (username!="") {
//             if (username.includes('@')) {
//                 username = username.replaceAll('@', '')
//             }

//             await ctx.reply(`Silakan hubungi admin dengan klik tombol di bawah ini`,
//                 Markup.inlineKeyboard([Markup.button.url("💬 Admin", `https://t.me/${username}`)])
//             )
//         } else {
//             await ctx.reply("🙅 Belum ada kontak admin tersedia!")
//         }
//     } catch(e) {
//         console.error(e.message)
//         await ctx.reply("Gagal mengambil informasi bantuan.");
//     }
// })
// ===============================================================================================

// ========================================== halaman cara order =================================
bot.action("caraorder", async (ctx) => {
    try {
        await ctx.answerCbQuery().catch(() => { })
        await ctx.deleteMessage().catch(() => { })

        const text = [`╭──────────────────`,
            `│ <b>🤔 Cara Order?</b>`,
            `├──────────────────`,
            `│ 1. Pilih menu "Katalog"`,
            `│ 2. Pilih kategori & produk yang ingin dibeli`,
            `│ 3. Atur jumlah pembelian (gunakan tombol + / -)`,
            `│ 4. Pilih metode pembayaran "QRIS"`,
            `│ 5. Scan kode QRIS dan lakukan pembayaran`,
            `│ 6. Pesanan akan dikirimkan otomatis setelah pembayaran terverifikasi`,
            `╰──────────────────`
        ];

        const reply = await ctx.reply(text.join('\n'), {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard([Markup.button.callback("⬅️ Menu Utama", "backCaraOrderUtama")])
        });

        if (!ctx.session) ctx.session = {};
        ctx.session.messageId_caraorder = reply.message_id;
    } catch (e) {
        console.error(e.message);
        await ctx.reply("Gagal mengambil informasi cara order.");
    }
});

bot.action("backCaraOrderUtama", async (ctx) => {
    try {
        await ctx.answerCbQuery().catch(() => { })
        await ctx.deleteMessage().catch(() => { })
        await halamanUtama(ctx)
        if (ctx.session) ctx.session.messageId_caraorder = null
    } catch (e) {
        console.error("[ERROR]", e.message)
    }
});

// ===========================================================================================

// ================================ SISTEM KATALOG BERBASIS BRAND / KATEGORI =====================================
const BRAND_METADATA = {
    // Multi-word specific matches first (prioritas pencocokan lebih spesifik)
    'youtube_music': { match: 'youtube music', name: 'YouTube Music' },
    'apple_music': { match: 'apple music', name: 'Apple Music' },
    'apple_tv': { match: 'apple tv', name: 'Apple TV+' },
    'alight_motion': { match: 'alight motion', name: 'Alight Motion' },
    'prime_video': { match: 'prime video', name: 'Prime Video' },
    'prime': { match: 'prime', name: 'Prime Video' },
    'disney': { match: 'disney', name: 'Disney+ Hotstar' },
    'hotstar': { match: 'hotstar', name: 'Disney+ Hotstar' },
    'google_one': { match: 'google one', name: 'Google One' },
    'google_drive': { match: 'google drive', name: 'Google Drive' },
    'gdrive': { match: 'gdrive', name: 'Google Drive' },
    'office_365': { match: 'office 365', name: 'Microsoft Office' },
    'microsoft': { match: 'microsoft', name: 'Microsoft 365' },
    'discord_nitro': { match: 'discord', name: 'Discord Nitro' },
    'nitro': { match: 'nitro', name: 'Discord Nitro' },
    'telegram_prem': { match: 'telegram', name: 'Telegram Premium' },
    'expressvpn': { match: 'expressvpn', name: 'ExpressVPN' },
    'nordvpn': { match: 'nordvpn', name: 'NordVPN' },
    'surfshark': { match: 'surfshark', name: 'Surfshark VPN' },
    'cyberghost': { match: 'cyberghost', name: 'CyberGhost' },
    'windscribe': { match: 'windscribe', name: 'Windscribe' },
    'ipvanish': { match: 'ipvanish', name: 'IPVanish' },
    'adguard': { match: 'adguard', name: 'AdGuard' },

    // Single-word / general matches
    'netflix': { match: 'netflix', name: 'Netflix' },
    'spotify': { match: 'spotify', name: 'Spotify' },
    'canva': { match: 'canva', name: 'Canva' },
    'capcut': { match: 'capcut', name: 'CapCut' },
    'youtube': { match: 'youtube', name: 'YouTube' },
    'chatgpt': { match: 'chatgpt', name: 'ChatGPT' },
    'openai': { match: 'openai', name: 'OpenAI' },
    'claude': { match: 'claude', name: 'Claude AI' },
    'midjourney': { match: 'midjourney', name: 'Midjourney' },
    'perplexity': { match: 'perplexity', name: 'Perplexity AI' },
    'gemini': { match: 'gemini', name: 'Gemini' },
    'quillbot': { match: 'quillbot', name: 'QuillBot' },
    'turnitin': { match: 'turnitin', name: 'Turnitin' },
    'grammarly': { match: 'grammarly', name: 'Grammarly' },
    'elevenlabs': { match: 'elevenlabs', name: 'ElevenLabs' },
    'runway': { match: 'runway', name: 'Runway ML' },
    'cursor': { match: 'cursor', name: 'Cursor AI' },
    'copilot': { match: 'copilot', name: 'GitHub Copilot' },
    'deepl': { match: 'deepl', name: 'DeepL Pro' },
    'alight': { match: 'alight', name: 'Alight Motion' },
    'viu': { match: 'viu', name: 'Viu' },
    'vidio': { match: 'vidio', name: 'Vidio' },
    'wetv': { match: 'wetv', name: 'WeTV' },
    'iqiyi': { match: 'iqiyi', name: 'iQIYI' },
    'bstation': { match: 'bstation', name: 'Bstation' },
    'bilibili': { match: 'bilibili', name: 'Bilibili' },
    'hbo': { match: 'hbo', name: 'HBO GO / Max' },
    'crunchyroll': { match: 'crunchyroll', name: 'Crunchyroll' },
    'catchplay': { match: 'catchplay', name: 'Catchplay+' },
    'loklok': { match: 'loklok', name: 'Loklok' },
    'vision': { match: 'vision', name: 'Vision+' },
    'picsart': { match: 'picsart', name: 'PicsArt' },
    'vsco': { match: 'vsco', name: 'VSCO' },
    'remini': { match: 'remini', name: 'Remini' },
    'adobe': { match: 'adobe', name: 'Adobe' },
    'lightroom': { match: 'lightroom', name: 'Lightroom' },
    'photoshop': { match: 'photoshop', name: 'Photoshop' },
    'freepik': { match: 'freepik', name: 'Freepik' },
    'envato': { match: 'envato', name: 'Envato Elements' },
    'shutterstock': { match: 'shutterstock', name: 'Shutterstock' },
    'meitu': { match: 'meitu', name: 'Meitu' },
    'inshot': { match: 'inshot', name: 'InShot' },
    'kinemaster': { match: 'kinemaster', name: 'KineMaster' },
    'figma': { match: 'figma', name: 'Figma' },
    'tidal': { match: 'tidal', name: 'Tidal' },
    'soundcloud': { match: 'soundcloud', name: 'SoundCloud' },
    'joox': { match: 'joox', name: 'Joox' },
    'resso': { match: 'resso', name: 'Resso' },
    'notion': { match: 'notion', name: 'Notion' },
    'zoom': { match: 'zoom', name: 'Zoom Pro' },
    'duolingo': { match: 'duolingo', name: 'Duolingo Plus' },
    'scribd': { match: 'scribd', name: 'Scribd' },
    'wattpad': { match: 'wattpad', name: 'Wattpad Premium' },

    // lainnya
    'script': { match: 'script', name: 'Script' }
};

function detectBrand(productName) {
    const lower = productName.toLowerCase();
    for (const [key, meta] of Object.entries(BRAND_METADATA)) {
        if (lower.includes(meta.match)) {
            return { key, name: meta.name };
        }
    }
    const firstWord = productName.split(/[-–—(]/)[0].trim();
    const cleanKey = firstWord.toLowerCase().replace(/[^a-z0-9_]/g, '');
    return { key: cleanKey || 'lainnya', name: firstWord || 'Lainnya' };
}

function getVariantButtonLabel(productName, brandName) {
    let label = productName;
    if (label.includes(' - ')) {
        const parts = label.split(' - ');
        parts.shift();
        label = parts.join(' - ').trim();
    } else if (brandName) {
        const regex = new RegExp(`^${brandName}\\s*`, 'i');
        label = label.replace(regex, '').trim();
    }
    return (label || productName).toUpperCase();
}

function formatShortPrice(price) {
    const num = Number(price) || 0;
    if (num >= 1000000) {
        const val = num / 1000000;
        return (val % 1 === 0 ? val : val.toFixed(1)).toString().replace('.', ',') + 'M';
    }
    if (num >= 1000) {
        const val = num / 1000;
        return (val % 1 === 0 ? val : val.toFixed(1)).toString().replace('.', ',') + 'K';
    }
    return num + 'P';
}

// fungsi untuk cek pending order berdasarkan produkid
async function checkProdukPending(produkId) {
    if (produkId) {
        const productReserved = await pool.query(`
            SELECT COALESCE(SUM(quantity), 0) AS reserved
            FROM orders
            WHERE product_id = $1
            AND status = 'pending'
            AND (expires_at > NOW() OR expires_at IS NULL)
        `, [produkId]);

        const stokdiReservasi = parseInt(productReserved.rows[0].reserved, 10);
        return stokdiReservasi;
    }
    return 0;
}

// Ambil produk aktif dan kelompokkan berdasarkan brand
async function getGroupedProducts() {
    const resultList = await pool.query(`
        SELECT
            p.id AS product_id,
            p.name AS product_name,
            p.price AS product_price,
            p.description AS product_description,
            (SELECT COUNT(*) FROM stocks s WHERE s.product_id = p.id AND s.status = 'available') AS stok_tersedia,
            (SELECT COALESCE(SUM(o.quantity), 0) FROM orders o WHERE o.product_id = p.id AND o.status = 'completed') AS total_terjual,
            (SELECT COALESCE(SUM(o2.quantity), 0) FROM orders o2 
             WHERE o2.product_id = p.id 
             AND o2.status = 'pending' 
             AND (o2.expires_at > NOW() OR o2.expires_at IS NULL)) AS stok_pending
        FROM products p
        WHERE p.active = TRUE
        ORDER BY p.name ASC
    `);

    if (resultList.rows.length === 0) return null;

    const groups = {};
    for (const product of resultList.rows) {
        const stokAvailableTotal = parseInt(product.stok_tersedia, 10) || 0;
        const pendingOrderTotal = parseInt(product.stok_pending, 10) || 0;
        const totalStock = Math.max(0, stokAvailableTotal - pendingOrderTotal);
        const totalTerjual = parseInt(product.total_terjual, 10) || 0;

        const brand = detectBrand(product.product_name);
        if (!groups[brand.key]) {
            groups[brand.key] = {
                key: brand.key,
                name: brand.name,
                products: []
            };
        }

        groups[brand.key].products.push({
            id: product.product_id,
            name: product.product_name,
            price: Number(product.product_price),
            description: product.product_description || '',
            stock: totalStock,
            terjual: totalTerjual
        });
    }

    return groups;
}

// Layar 1: Menu Kategori Produk (Nomor pada inline keyboard & nama di caption tanpa emoji)
async function halamanKatalog(ctx, isEdit = true, page = 0) {
    try {
        if (ctx.callbackQuery) {
            await ctx.answerCbQuery().catch(() => { });
        }
        const groups = await getGroupedProducts();

        if (!groups || Object.keys(groups).length === 0) {
            return await ctx.reply("📦 Produk belum tersedia saat ini.");
        }

        if (!ctx.session) ctx.session = {};
        ctx.session.grouped_products = groups;

        const groupKeys = Object.keys(groups);
        const item_per_halaman = Number(process.env.ITEM_PER_HALAMAN) || 10;
        const totalPages = Math.ceil(groupKeys.length / item_per_halaman);
        const currentPage = Math.max(0, Math.min(page, totalPages - 1));

        const start = currentPage * item_per_halaman;
        const end = start + item_per_halaman;
        const pagedKeys = groupKeys.slice(start, end);

        const lines = [
            `╭──────────────────`,
            `│ 📦 <b>KATALOG PRODUK</b>`,
            `├──────────────────`
        ];

        const numButtons = [];
        pagedKeys.forEach((key, idx) => {
            const num = start + idx + 1;
            const g = groups[key];
            lines.push(`│ <b>[${num}]</b> ${g.name.toUpperCase()}`);
            numButtons.push(Markup.button.callback(String(num), `kategori:${g.key}`));
        });

        if (totalPages > 1) {
            lines.push(`├──────────────────`);
            lines.push(`│ 📄 Halaman: ${currentPage + 1} / ${totalPages}`);
        }
        lines.push(`╰──────────────────\n`);
        lines.push(`<i>Silakan pilih nomor kategori produk di bawah ini:</i>`);

        const keyboardRows = [];
        const kolomPerBaris = 5; // Batas ideal per baris agar rapi di layar HP
        for (let i = 0; i < numButtons.length; i += kolomPerBaris) {
            keyboardRows.push(numButtons.slice(i, i + kolomPerBaris));
        }

        if (totalPages > 1) {
            const navRow = [];
            if (currentPage > 0) {
                navRow.push(Markup.button.callback("◀️ Sebelumnya", `katalog_page:${currentPage - 1}`));
            }
            if (currentPage < totalPages - 1) {
                navRow.push(Markup.button.callback("▶️ Berikutnya", `katalog_page:${currentPage + 1}`));
            }
            if (navRow.length > 0) keyboardRows.push(navRow);
        }

        keyboardRows.push([Markup.button.callback("↩️ Menu Utama", "backListProdukUtama")]);

        const caption = lines.join('\n');

        if (isEdit && ctx.callbackQuery) {
            try {
                await ctx.editMessageCaption(caption, {
                    parse_mode: 'HTML',
                    ...Markup.inlineKeyboard(keyboardRows)
                });
            } catch (errEditCaption) {
                if (errEditCaption.message?.includes('message is not modified')) return;
                try {
                    await ctx.editMessageMedia(
                        {
                            type: 'photo',
                            media: { source: "./assets/banner.png" },
                            caption: caption,
                            parse_mode: 'HTML'
                        },
                        Markup.inlineKeyboard(keyboardRows)
                    );
                } catch (errEditMedia) {
                    if (errEditMedia.message?.includes('message is not modified')) return;
                    throw errEditMedia;
                }
            }
        } else {
            await ctx.replyWithPhoto(
                { source: "./assets/banner.png" },
                {
                    caption: caption,
                    parse_mode: 'HTML',
                    ...Markup.inlineKeyboard(keyboardRows)
                }
            );
        }
        console.log("[INFO]", ctx.chat.id, "sedang menampilkan katalog");
    } catch (e) {
        if (e.message?.includes('message is not modified')) return;
        console.error("[ERROR] Gagal menampilkan katalog:", e.message);
        await ctx.reply("Gagal menampilkan katalog produk.");
    }
}

// Layar 2: Daftar Varian Berdasarkan Brand (Judul 🔖 VARIASI, detail tanpa emoji, tombol ↩️)
async function halamanVarianKategori(ctx, brandKey, isEdit = true, page = 0) {
    try {
        if (ctx.callbackQuery) {
            await ctx.answerCbQuery().catch(() => { });
        }
        const groups = await getGroupedProducts();
        if (!groups || !groups[brandKey]) {
            return await halamanKatalog(ctx, isEdit);
        }
        if (!ctx.session) ctx.session = {};
        ctx.session.grouped_products = groups;

        const group = groups[brandKey];
        ctx.session.last_brand_key = brandKey;

        const VARIAN_PER_HALAMAN = 5; // Maksimal 5 varian per halaman
        const totalPages = Math.ceil(group.products.length / VARIAN_PER_HALAMAN);
        const currentPage = Math.max(0, Math.min(page, totalPages - 1));

        const start = currentPage * VARIAN_PER_HALAMAN;
        const end = start + VARIAN_PER_HALAMAN;
        const pagedProducts = group.products.slice(start, end);

        const lines = [
            `╭──────────────────`,
            `│ 🔖 <b>VARIASI ${group.name.toUpperCase()}</b>`,
            `├──────────────────`
        ];

        const keyboardRows = [];

        pagedProducts.forEach((p, idx) => {
            const num = start + idx + 1;
            const priceFormatted = Number(p.price).toLocaleString('id-ID');
            let desc = p.description ? p.description.trim() : 'Tanpa deskripsi';
            if (pagedProducts.length >= 4 && desc.length > 95) {
                desc = desc.slice(0, 92).trim() + '...';
            }

            lines.push(`│ <b>[${num}] ${p.name.toUpperCase()}</b>`);
            lines.push(`│ ⬩ Harga: Rp ${priceFormatted}`);
            lines.push(`│ ⬩ Stok: ${p.stock}`);
            lines.push(`│ ⬩ Terjual: ${p.terjual} pcs`);
            lines.push(`│ ⬩ <i>${desc}</i>`);
            if (idx < pagedProducts.length - 1) {
                lines.push(`├──────────────────`);
            }

            const variantName = getVariantButtonLabel(p.name, group.name);
            const shortPrice = formatShortPrice(p.price);
            const buttonLabel = `${variantName} (${p.stock}) - ${shortPrice}`;
            keyboardRows.push([Markup.button.callback(buttonLabel, `produk:${p.id}:${brandKey}`)]);
        });

        if (totalPages > 1) {
            lines.push(`├──────────────────`);
            lines.push(`│ 📄 Halaman: ${currentPage + 1} / ${totalPages}`);
        }
        lines.push(`╰──────────────────\n`);
        lines.push(`<i>Silakan pilih varian di bawah ini untuk membeli:</i>`);

        if (totalPages > 1) {
            const navRow = [];
            if (currentPage > 0) {
                navRow.push(Markup.button.callback("◀️ Sebelumnya", `varian_page:${brandKey}:${currentPage - 1}`));
            }
            if (currentPage < totalPages - 1) {
                navRow.push(Markup.button.callback("▶️ Berikutnya", `varian_page:${brandKey}:${currentPage + 1}`));
            }
            if (navRow.length > 0) keyboardRows.push(navRow);
        }

        keyboardRows.push([Markup.button.callback("⬅️ Kembali", "backToKatalog")]);

        let caption = lines.join('\n');
        if (caption.length > 1020) {
            caption = caption.slice(0, 1017) + '...';
        }

        if (isEdit && ctx.callbackQuery) {
            try {
                await ctx.editMessageCaption(caption, {
                    parse_mode: 'HTML',
                    ...Markup.inlineKeyboard(keyboardRows)
                });
            } catch (errEditCaption) {
                if (errEditCaption.message?.includes('message is not modified')) return;
                try {
                    await ctx.editMessageMedia(
                        {
                            type: 'photo',
                            media: { source: "./assets/banner.png" },
                            caption: caption,
                            parse_mode: 'HTML'
                        },
                        Markup.inlineKeyboard(keyboardRows)
                    );
                } catch (errEditMedia) {
                    if (errEditMedia.message?.includes('message is not modified')) return;
                    throw errEditMedia;
                }
            }
        } else {
            await ctx.replyWithPhoto(
                { source: "./assets/banner.png" },
                {
                    caption: caption,
                    parse_mode: 'HTML',
                    ...Markup.inlineKeyboard(keyboardRows)
                }
            );
        }
        console.log("[INFO]", ctx.chat.id, "sedang menampilkan variasi", group.name);
    } catch (e) {
        if (e.message?.includes('message is not modified')) return;
        console.error("[ERROR] Gagal menampilkan varian kategori:", e.message);
        await ctx.reply("Gagal menampilkan varian produk.");
    }
}

bot.action(/^katalog_page:(\d+)$/, async (ctx) => {
    const page = parseInt(ctx.match[1], 10);
    await halamanKatalog(ctx, true, page);
});

bot.action(/^varian_page:([a-z0-9_-]+):(\d+)$/, async (ctx) => {
    const brandKey = ctx.match[1];
    const page = parseInt(ctx.match[2], 10);
    await halamanVarianKategori(ctx, brandKey, true, page);
});

bot.action(/^kategori:([a-z0-9_-]+)$/, async (ctx) => {
    const brandKey = ctx.match[1];
    await halamanVarianKategori(ctx, brandKey, true);
});

bot.action("backToKatalog", async (ctx) => {
    await halamanKatalog(ctx, true);
});

bot.action(["katalog", "products"], async (ctx) => {
    await ctx.answerCbQuery().catch(() => { });
    await halamanKatalog(ctx, true);
});

bot.command(["katalog", "produk"], async (ctx) => {
    await halamanKatalog(ctx, false);
});

bot.action("backListProdukUtama", async (ctx) => {
    try {
        await ctx.answerCbQuery().catch(() => { })

        let username = process.env.USERNAME_TG_ADMIN

        if (username != "") {
            if (username.includes('@')) {
                username = username.replaceAll('@', '')
            }
        } else {
            username = "123"
        }

        try {
            const statistikResult = await pool.query(`
                SELECT 
                    (SELECT COUNT(*) FROM users) AS total_user,
                    COALESCE(SUM(quantity), 0) AS total_terjual,
                    COALESCE(SUM(total), 0) AS total_transaksi
                FROM orders
                WHERE status = 'completed'
            `)

            const statistik = statistikResult.rows[0]
            console.log("[INFO]", ctx.chat.id, "sedang memulai bot")

            const menuCaption = fmt`Halo ${bold`${ctx.chat?.first_name}`}. Selamat datang di ${bold`${process.env.NAMA_TOKO}`}.
\n${process.env.DESKRIPSI_TOKO ? italic`${process.env.DESKRIPSI_TOKO}` : italic`Selamat berbelanja`}
\n${bold`Statistik:`}\n┖ Total Terjual: ${statistik.total_terjual} pcs\n┖ Total User: ${statistik.total_user}
\nSilakan pilih menu di bawah ini!`;

            const menuKeyboard = Markup.inlineKeyboard([
                [
                    Markup.button.callback("📦 Katalog", "katalog"),
                    Markup.button.callback("📊 Laporan Stok", "stok")
                ],
                [
                    Markup.button.callback("📋 Pesanan Saya", "orders"),
                    Markup.button.callback("👤 Profile", "profile"),
                ],
                [
                    Markup.button.callback("❓ Cara Order", "caraorder"),
                    Markup.button.url("ℹ️ Bantuan", `https://t.me/${username}`)
                ]
            ]);

            try {
                await ctx.editMessageCaption(menuCaption, {
                    parse_mode: 'HTML',
                    ...menuKeyboard
                });
            } catch (errEditCaption) {
                await ctx.editMessageMedia(
                    {
                        type: 'photo',
                        media: { source: "./assets/banner.png" },
                        caption: menuCaption,
                        parse_mode: 'HTML'
                    },
                    menuKeyboard
                );
            }
        } catch (e) {
            console.error(e.message)
        }
    } catch (e) {
        console.log(e.message)
    }
})

bot.action("backInformasiOrderList", async (ctx) => {
    try {
        await ctx.answerCbQuery().catch(() => { });
        await halamanKatalog(ctx, false);
    } catch (e) {
        console.error("[ERROR] Gagal kembali ke katalog", e.message);
        await ctx.reply("Gagal mengambil katalog.");
    }
});
// ===================================== halaman checkout ======================================
bot.action(/^produk:(\d+)(?::([a-z0-9_-]+))?$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => { });
    const paramId = parseInt(ctx.match[1], 10);
    const brandKey = ctx.match[2];
    if (brandKey) {
        if (!ctx.session) ctx.session = {};
        ctx.session.last_brand_key = brandKey;
    }

    try {
        // Cari produk berdasarkan ID langsung di database
        let produkResult = await pool.query(`
            SELECT *
            FROM products
            WHERE id = $1
            AND active = TRUE
        `, [paramId]);

        let produk = produkResult.rows[0];

        // Fallback backward-compatible jika ada tombol lama berbasis index 1..N
        if (!produk && ctx.session?.current_brand_products) {
            const fallbackItem = ctx.session.current_brand_products[paramId - 1];
            if (fallbackItem) {
                produkResult = await pool.query(`
                    SELECT *
                    FROM products
                    WHERE id = $1
                    AND active = TRUE
                `, [fallbackItem.id]);
                produk = produkResult.rows[0];
            }
        }

        if (!produk) {
            return await ctx.reply("Produk tidak ditemukan atau sudah tidak aktif. Silakan buka menu 📦 <b>Katalog</b> kembali.", { parse_mode: "HTML" });
        }

        console.log('[INFO]', ctx.chat.id, "sedang menampilkan data produk", produk.name);

        let qty = 1; // kuantitas default 1
        if (!ctx.session) ctx.session = {};
        if (!ctx.session.viewed_prices) ctx.session.viewed_prices = {};
        ctx.session.viewed_prices[produk.id] = Number(produk.price);

        if (ctx.callbackQuery) {
            const detailText = await getProdukDetail(produk, qty);
            try {
                await ctx.editMessageCaption(
                    detailText,
                    {
                        parse_mode: "HTML",
                        ...getCounterKeyboard(produk, qty)
                    }
                );
            } catch (errEditCaption) {
                if (errEditCaption.message?.includes('message is not modified')) return;
                try {
                    await ctx.editMessageMedia(
                        {
                            type: 'photo',
                            media: { source: "./assets/banner.png" },
                            caption: detailText,
                            parse_mode: "HTML"
                        },
                        getCounterKeyboard(produk, qty)
                    );
                } catch (errEditMedia) {
                    if (errEditMedia.message?.includes('message is not modified')) return;
                    throw errEditMedia;
                }
            }
        } else {
            await ctx.replyWithPhoto(
                { source: "./assets/banner.png" },
                {
                    caption: await getProdukDetail(produk, qty),
                    parse_mode: "HTML",
                    ...getCounterKeyboard(produk, qty)
                }
            );
        }

    } catch (e) {
        if (e.message?.includes('message is not modified')) return;
        console.error("[ERROR]", ctx.chat.id, "gagal memproses produk:", e.message);
        await ctx.reply(`Klik <b>Katalog</b> atau jalankan perintah /katalog kembali`,
            { parse_mode: "HTML" }
        );
    }
});

async function getProdukDetail(produk, qty) {
    if (produk) {
        const stokAvailable = await checkStokAvailable(produk.id);
        const pendingOrder = await checkProdukPending(produk.id);
        const totalStock = Math.max(0, (stokAvailable || 0) - (pendingOrder || 0));

        const terjualRes = await pool.query(`
            SELECT COALESCE(SUM(quantity), 0) AS total_terjual
            FROM orders
            WHERE product_id = $1 AND status = 'completed'
        `, [produk.id]);
        const totalterjual = parseInt(terjualRes.rows[0]?.total_terjual, 10) || 0;
        const total = qty * produk.price;

        const text = [
            `╭──────────────────`,
            `│ 🛒 <b>KONFIRMASI PESANAN</b>`,
            `├──────────────────`,
            `│ ⬩ <b>Produk:</b> <code>${produk.name.toUpperCase()}</code>`,
            `│ ⬩ <b>Harga:</b> Rp ${Number(produk.price).toLocaleString('id-ID')}`,
            `│ ⬩ <b>Stok:</b> ${totalStock}`,
            `│ ⬩ <b>Terjual:</b> ${totalterjual}`,
            `│ ⬩ <b>Deskripsi:</b> ${produk.description || '-'}`,
            `├──────────────────`,
            `│ ⬩ <b>Jumlah:</b> ${qty}`,
            `│ ⬩ <b>Total:</b> Rp ${total.toLocaleString('id-ID')}`,
            `╰──────────────────\n`,
            `<i>Atur jumlah (+ / -) lalu klik <b>Bayar QRIS</b>.</i>`

        ].join('\n');

        return text;
    } else {
        return "Klik <b>Katalog</b> atau jalankan perintah /katalog kembali";
    }
}

// tombol [-] dan [+] dan bayar
function getCounterKeyboard(produk, qty) {
    if (produk) {
        return Markup.inlineKeyboard([
            [
                Markup.button.callback("-5", `step:kurang:5:${qty}:${produk.id}`),
                Markup.button.callback("-1", `step:kurang:1:${qty}:${produk.id}`),
                Markup.button.callback("+1", `step:tambah:1:${qty}:${produk.id}`),
                Markup.button.callback("+5", `step:tambah:5:${qty}:${produk.id}`),
            ],
            [Markup.button.callback("💴 Bayar QRIS", `paymentQris:${qty}:${produk.id}`)],
            [
                Markup.button.callback("⬅️ Kembali", "backCheckoutListProduk"),
                Markup.button.callback("↩️ Katalog", "backToKatalogDirect")
            ]
        ]);
    } else {
        return Markup.inlineKeyboard([
            [
                Markup.button.callback("⬅️ Kembali", "backCheckoutListProduk"),
                Markup.button.callback("↩️ Katalog", "backToKatalogDirect")
            ]
        ]);
    }
}

bot.action("backCheckoutListProduk", async (ctx) => {
    await ctx.answerCbQuery().catch(() => { });
    if (ctx.session?.last_brand_key) {
        await halamanVarianKategori(ctx, ctx.session.last_brand_key, true);
    } else {
        await halamanKatalog(ctx, true);
    }
});

bot.action("backToKatalogDirect", async (ctx) => {
    await ctx.answerCbQuery().catch(() => { });
    await halamanKatalog(ctx, true);
});

// handler +/- (mendukung step: -5, -1, +1, +5)
bot.action(/^(?:step:(tambah|kurang):(\d+)|(tambah|kurang):JumlahBeli):(\d+):(\d+)$/, async (ctx) => {
    const action = ctx.match[1] || ctx.match[3];
    const step = ctx.match[2] ? parseInt(ctx.match[2], 10) : 1;
    let qty = parseInt(ctx.match[4], 10);
    const productId = ctx.match[5];

    try {
        const produkResult = await pool.query(`
            SELECT *
            FROM products
            WHERE id = $1 AND active = TRUE
        `, [productId]);

        const produk = produkResult.rows[0];
        if (!produk) {
            return await ctx.reply("Produk tidak ditemukan/sudah terhapus");
        }

        const stokAvailable = await checkStokAvailable(productId);
        const productPending = await checkProdukPending(productId);
        const totalStock = Math.max(0, (stokAvailable || 0) - (productPending || 0));

        // 1. Jika stok habis sama sekali
        if (totalStock === 0) {
            return await ctx.answerCbQuery('Stok produk saat ini habis!', { show_alert: true }).catch(() => { });
        }

        // 2. Jika quantity saat ini melebihi stok yang tersedia (misal karena stok baru saja berkurang),
        // otomatis set quantity ke totalStock (maksimal yang tersedia)
        if (qty > totalStock) {
            qty = totalStock;
            await ctx.answerCbQuery(`Jumlah disesuaikan ke stok maksimal: ${qty}`).catch(() => { });
        } else if (action === 'kurang') {
            if (qty <= 1) {
                return await ctx.answerCbQuery('Minimal pembelian adalah 1!').catch(() => { });
            }
            qty = Math.max(1, qty - step);
            await ctx.answerCbQuery(`Jumlah: ${qty}`).catch(() => { });
        } else if (action === 'tambah') {
            if (qty >= totalStock) {
                return await ctx.answerCbQuery('Jumlah stok tersedia sudah maksimal').catch(() => { });
            }
            // Math.min memastikan jika klik +5 dan melebihi totalStock, qty akan mentok di totalStock
            qty = Math.min(totalStock, qty + step);
            await ctx.answerCbQuery(`Jumlah: ${qty}`).catch(() => { });
        }

        try {
            const detailText = await getProdukDetail(produk, qty);
            try {
                await ctx.editMessageCaption(
                    detailText,
                    {
                        parse_mode: 'HTML',
                        ...getCounterKeyboard(produk, qty)
                    }
                );
            } catch (errEditCaption) {
                await ctx.editMessageMedia(
                    {
                        type: 'photo',
                        media: { source: "./assets/banner.png" },
                        caption: detailText,
                        parse_mode: 'HTML'
                    },
                    getCounterKeyboard(produk, qty)
                );
            }
        } catch (error) {
            console.error('Error edit message:', error.message);
        }
    } catch (error) {
        await ctx.answerCbQuery("Gagal menambah atau mengurangi produk").catch(() => { })
        // console.error('Error menambahkan atau mengurangi produk:', error);
    }
})
// =============================================================================================

// ===================================== halaman payment ======================================
bot.action(/^paymentQris:(\d+):(\d+)$/, async (ctx) => {
    let qty = parseInt(ctx.match[1], 10); // Menangkap angka kuantitas
    let productId = parseInt(ctx.match[2], 10);  // Angka kedua (product_id)

    try {
        let userId = await checkUser(ctx); // Cek user terdaftar

        const productResult = await pool.query(`
            SELECT *
            FROM products
            WHERE id = $1
        `, [productId]);

        const product = productResult.rows[0];

        // jika produk tidak ada atau nonaktif
        if (!product || product.active === false) {
            return await ctx.answerCbQuery("Produk telah dihapus atau tidak aktif! Silakan pilih produk lain di Katalog.", { show_alert: true }).catch(() => { });
        }

        const currentPrice = Number(product.price);
        const lastViewedPrice = ctx.session?.viewed_prices?.[productId];

        // Jika user sedang melihat harga lama dan admin baru saja mengubah harga di database:
        if (lastViewedPrice !== undefined && lastViewedPrice !== currentPrice) {
            if (!ctx.session) ctx.session = {};
            if (!ctx.session.viewed_prices) ctx.session.viewed_prices = {};
            ctx.session.viewed_prices[productId] = currentPrice;

            // Perbarui tampilan pesan konfirmasi ke harga terbaru
            try {
                const detailText = await getProdukDetail(product, qty);
                await ctx.editMessageCaption(detailText, {
                    parse_mode: "HTML",
                    ...getCounterKeyboard(product, qty)
                }).catch(() => { });
            } catch (e) { }

            return await ctx.answerCbQuery(`Harga produk telah diperbarui menjadi Rp ${currentPrice.toLocaleString('id-ID')}. Silakan klik Bayar QRIS kembali jika setuju.`, { show_alert: true }).catch(() => { });
        }

        // jika pembelian dibawah rp 500 maka nggak bisa
        if (currentPrice * qty < 500) {
            return await ctx.answerCbQuery("Minimal pembelian Rp. 500", { show_alert: true }).catch(() => { });
        }

        // jika pas di klik user masih ada pending payment
        const [userPending, orderId] = await checkUserPending(userId);
        if (userPending) {
            return await ctx.answerCbQuery("Anda masih memiliki transaksi pending. Selesaikan pembayaran terlebih dahulu, cancel, atau tunggu transaksi expired (15 menit sejak order dibuat)", { show_alert: true }).catch(() => { });
        }

        const productPending = await checkProdukPending(product.id);
        const stokAvailable = await checkStokAvailable(product.id);

        // jika produk yang tersedia kurang dari stok tersedia
        if (stokAvailable - productPending < qty) {
            return await ctx.answerCbQuery('Stok tidak mencukupi', { show_alert: true }).catch(() => { });
        }

        // jika memenuhi syarat diatas maka buatkan order
        const total = currentPrice * Number(qty);
        const buatTX = await buatPayment(total, product.name, qty);
        if (!buatTX || !buatTX.success || !buatTX.data?.depositId) {
            return await ctx.answerCbQuery("Gagal membuat QRIS, silakan coba beberapa saat lagi.", { show_alert: true }).catch(() => { });
        }

        const orderResult = await pool.query(`
            INSERT INTO orders (
                user_id,
                product_id,
                quantity,
                amount,
                status,
                expires_at,
                message_id,
                payment_reference,
                total
            )
            VALUES (
                $1,
                $2,
                $3,
                $4,
                'pending',
                NOW() + INTERVAL '15 minutes',
                NULL,
                $5,
                $6
            )
            RETURNING *
        `, [
            userId,
            product.id,
            qty,
            total,
            buatTX.data.depositId,
            buatTX.data.totalAmount
        ]);

        const order = orderResult.rows[0];

        const qrUrl = await generateQRimage(buatTX.data.qrString);
        const orderCaption = await getOrderText(buatTX, order);
        const orderKeyboard = Markup.inlineKeyboard([
            [Markup.button.callback("🚫 Batalkan Pesanan", `batalkanOrder:${order.id}`)]
        ]);

        let messageId = null;
        if (ctx.callbackQuery) {
            try {
                await ctx.editMessageMedia(
                    {
                        type: 'photo',
                        media: qrUrl,
                        caption: orderCaption,
                        parse_mode: "HTML"
                    },
                    orderKeyboard
                );
                messageId = ctx.callbackQuery.message.message_id;
            } catch (errEdit) {
                console.error("[EDIT MEDIA QRIS ERROR]", errEdit.message);
                const reply = await ctx.replyWithPhoto(qrUrl, {
                    caption: orderCaption,
                    parse_mode: "HTML",
                    ...orderKeyboard
                });
                messageId = reply.message_id;
            }
        } else {
            const reply = await ctx.replyWithPhoto(qrUrl, {
                caption: orderCaption,
                parse_mode: "HTML",
                ...orderKeyboard
            });
            messageId = reply.message_id;
        }

        await pool.query(`
            UPDATE orders
            SET message_id = $1
            WHERE id = $2 AND user_id = $3
        `, [
            messageId,
            order.id,
            userId,
        ]);

        console.log("[INFO]", ctx.chat.id, "membuat transaksi dengan id", buatTX.data.depositId);
    } catch (error) {
        console.error("[ERROR PAYMENT QRIS]", error);
        await ctx.answerCbQuery("Gagal membuat order, silakan coba beberapa saat lagi.", { show_alert: true }).catch(() => { });
    }
});

async function checkStokAvailable(productId) {
    try {
        const stockResult = await pool.query(`
            SELECT COUNT(*) as total
            FROM stocks
            WHERE product_id = $1
            AND status = 'available'
        `, [productId])

        const totalStock = parseInt(stockResult.rows[0].total);

        return totalStock
    } catch (error) {
        console.log(error.message);
        return 0;
    }
}

async function checkUserPending(userId) {
    try {
        //ada pending order tidak
        const pendingOrder = await pool.query(`
            SELECT id
            FROM orders
            WHERE user_id = $1
            AND status = 'pending'
            AND (expires_at > NOW() OR expires_at IS NULL)
            LIMIT 1
        `, [userId]);

        if (pendingOrder.rows.length > 0) {
            const orderId = pendingOrder.rows[0].id;

            return [true, orderId];
        } else {
            return [false, null];
        }
    } catch (error) {
        console.log(error.message);
        return [false, null];
    }
}

async function generateQRimage(qrString) {
    try {
        const qrSize = 460;
        const qrBuffer = await QRCode.toBuffer(qrString, {
            errorCorrectionLevel: 'M',
            margin: 0,
            width: qrSize,
            color: { dark: '#000000', light: '#ffffff' }
        });

        // Template 1024x1024 persegi (Rasio 1:1, aman mobile tanpa crop)
        // Kartu putih center: X = 511.5, Y = 511.5 (bounds: left=229, right=794, top=229, bottom=794)
        const left = Math.round(511.5 - qrSize / 2); // 282
        const top = Math.round(511.5 - qrSize / 2);  // 282

        const composed = await sharp('assets/qris_template.jpg')
            .composite([{
                input: qrBuffer,
                left: left,
                top: top
            }])
            .jpeg({ quality: 95 })
            .toBuffer();

        return { source: composed };
    } catch (err) {
        console.error("[ERROR GENERATE QR COMPOSITE]", err.message);
        return `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${qrString}&margin=10`;
    }
}

async function getOrderText(transaksi, order) {
    if (transaksi?.success) {
        try {
            const orderResult = await pool.query(`
                SELECT 
                    o.*, 
                    p.name AS product_name,
                    p.price AS product_price
                FROM orders o
                JOIN products p ON o.product_id = p.id
                WHERE o.payment_reference = $1;
            `, [order.payment_reference]);

            if (orderResult.rows.length === 0) {
                return "Gagal mengambil data pesanan.";
            }

            const orderinfo = orderResult.rows[0];

            const d = new Date(orderinfo.created_at);
            const waktuOrder = `${d.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Jakarta' })}, ${d.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: "2-digit", minute: "2-digit", hour12: false })} WIB`;

            // jika status pending
            if ((!transaksi.data?.status || transaksi.data?.status === "pending") && order.status === "pending") {
                const enddate = new Date(transaksi.data?.expiredAt || orderinfo.expires_at || (Date.now() + 15 * 60 * 1000));
                const expOrder = `${enddate.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Jakarta' })}, ${enddate.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: "2-digit", minute: "2-digit", hour12: false })} WIB`;
                const fee = Math.max(0, Number(orderinfo.total) - (Number(orderinfo.product_price) * Number(orderinfo.quantity)));
                const ordernya = {
                    reffid: orderinfo.payment_reference,
                    name: orderinfo.product_name.toUpperCase(),
                    metode: "QRIS",
                    harga: Number(orderinfo.product_price).toLocaleString('id-ID'),
                    jumlah: orderinfo.quantity,
                    fee: fee.toLocaleString('id-ID'),
                    total: Number(orderinfo.total).toLocaleString('id-ID'),
                    status: "MENUNGGU PAYMENT"
                };
                await sendNotifMonitoring(ordernya); // send notif

                const text = [
                    `╭──────────────────`,
                    `│ 🛒 <b>INFORMASI ORDER</b>`,
                    `├──────────────────`,
                    `│ ⬩ <b>Reff ID:</b> <code>${orderinfo.payment_reference}</code>`,
                    `│ ⬩ <b>Produk:</b> <code>${orderinfo.product_name.toUpperCase()}</code>`,
                    `│ ⬩ <b>Metode pembayaran:</b> QRIS`,
                    `│ ⬩ <b>Harga:</b> Rp ${Number(orderinfo.product_price).toLocaleString('id-ID')}`,
                    `│ ⬩ <b>Jumlah:</b> ${orderinfo.quantity}`,
                    `│ ⬩ <b>Fee:</b> Rp ${fee.toLocaleString('id-ID')}`,
                    `│ ⬩ <b>Total Bayar:</b> Rp ${Number(orderinfo.total).toLocaleString('id-ID')}`,
                    `├──────────────────`,
                    `│ ⬩ <b>Status:</b> MENUNGGU PAYMENT`,
                    `│ ⬩ <b>Tgl/jam:</b> ${waktuOrder}`,
                    `│ ⬩ <b>Expired:</b> ${expOrder}`,
                    `├──────────────────`,
                    `│ ⏰ Waktu: ${waktuSekarang()}`,
                    `╰──────────────────\n`,
                ].join('\n');

                return text;
            }
        } catch (error) {
            console.error("[ERROR GET ORDER TEXT]", error.message);
            return "Gagal memproses data pesanan.";
        }
    }
    return "Gagal mengambil data";
}

bot.action(/^batalkanOrder:(\d+)/, async (ctx) => {
    let orderId = parseInt(ctx.match[1], 10);
    const userId = ctx.from.id;

    if (cooldown.has(userId)) {
        return ctx.answerCbQuery("⏳ Tunggu sebentar...").catch(() => { });
    }

    cooldown.set(userId, true);
    setTimeout(() => { cooldown.delete(userId); }, 3000);

    try {
        const orderResult = await pool.query(`
            SELECT o.*, p.name AS product_name, p.price AS product_price
            FROM orders o
            JOIN products p ON o.product_id = p.id
            WHERE o.id = $1 AND o.status = 'pending'
        `, [orderId]);

        if (orderResult.rows.length === 0) {
            return await ctx.answerCbQuery("Pesanan sudah tidak aktif atau sudah diproses.", { show_alert: true }).catch(() => { });
        }

        const order = orderResult.rows[0];

        // Beri respon instan pada tombol agar Telegram tidak timeout
        await ctx.answerCbQuery("⏳ Memeriksa mutasi pembayaran...").catch(() => { });

        // Jeda wajar 2.5 detik agar mutasi perbankan/QRIS yang baru saja ditransfer sempat terdeteksi
        await new Promise(resolve => setTimeout(resolve, 2500));

        // Cek status ke payment gateway
        const payment = await cekPayment(order.payment_reference);

        if (payment && payment.data && payment.data.status === "success") {
            return await ctx.reply("⚠️ <b>Pembayaran Anda telah terverifikasi sukses!</b>\n\nProduk sedang dipersiapkan dan akan segera diserahkan otomatis ke chat ini.", { parse_mode: "HTML" }).catch(() => { });
        }

        if (payment && payment.data && payment.data.status === "expired") {
            await pool.query(`UPDATE orders SET status = 'expired' WHERE id = $1 AND status = 'pending'`, [order.id]);

            const d = new Date(order.created_at);
            const waktuOrder = `${d.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Jakarta' })}, ${d.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: "2-digit", minute: "2-digit", hour12: false })} WIB`;

            const feeExp = Math.max(0, Number(order.total) - (Number(order.product_price) * Number(order.quantity)));
            const ordernya = {
                reffid: order.payment_reference,
                name: order.product_name.toUpperCase(),
                metode: "QRIS",
                harga: Number(order.product_price).toLocaleString('id-ID'),
                jumlah: order.quantity,
                fee: feeExp.toLocaleString('id-ID'),
                total: Number(order.total).toLocaleString('id-ID'),
                status: "KADALUARSA"
            };
            await sendNotifMonitoring(ordernya);

            const textExpired = [
                `╭──────────────────`,
                `│ 🛒 <b>INFORMASI ORDER</b>`,
                `├──────────────────`,
                `│ ⬩ <b>Reff ID:</b> <code>${order.payment_reference}</code>`,
                `│ ⬩ <b>Metode pembayaran:</b> QRIS`,
                `├──────────────────`,
                `│ ⬩ <b>Status:</b> KADALUARSA`,
                `│ ⬩ <b>Tgl/jam:</b> ${waktuOrder}`,
                `╰──────────────────\n`,
                `<i>⚠️ Batas waktu pembayaran telah habis (kadaluarsa). Silakan buat pesanan baru.</i>`
            ].join('\n');

            const brand = detectBrand(order.product_name);
            const brandKey = brand?.key || 'lainnya';

            const expKeyboard = Markup.inlineKeyboard([
                [Markup.button.callback("🔖 Kembali ke Variasi", `backInformasiVariasi:${brandKey}`)],
                [
                    Markup.button.callback("📦 Katalog", "backInformasiOrderList"),
                    Markup.button.callback("↩️ Menu Utama", "backInformasiUtama")
                ]
            ]);

            await ctx.deleteMessage().catch(() => { });
            return await ctx.reply(textExpired, {
                parse_mode: "HTML",
                ...expKeyboard
            });
        }

        // Batalkan pesanan di database
        const result = await pool.query(`
            UPDATE orders
            SET status = 'cancelled'
            WHERE id = $1
            AND user_id = $2
            AND status = 'pending'
            RETURNING *
        `, [
            order.id,
            order.user_id
        ]);

        if (result.rows.length === 0) {
            return await ctx.reply("⚠️ Pesanan sudah tidak aktif atau telah diproses sebelumnya.").catch(() => { });
        }

        const d = new Date(order.created_at);
        const waktuOrder = `${d.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Jakarta' })}, ${d.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: "2-digit", minute: "2-digit", hour12: false })} WIB`;

        const feeBatal = Math.max(0, Number(order.total) - (Number(order.product_price) * Number(order.quantity)));
        const ordernya = {
            reffid: order.payment_reference,
            name: order.product_name.toUpperCase(),
            metode: "QRIS",
            harga: Number(order.product_price).toLocaleString('id-ID'),
            jumlah: order.quantity,
            fee: feeBatal.toLocaleString('id-ID'),
            total: Number(order.total).toLocaleString('id-ID'),
            status: "DIBATALKAN"
        };
        await sendNotifMonitoring(ordernya);

        const textBatal = [
            `╭──────────────────`,
            `│ 🛒 <b>INFORMASI ORDER</b>`,
            `├──────────────────`,
            `│ ⬩ <b>Reff ID:</b> <code>${order.payment_reference}</code>`,
            `│ ⬩ <b>Metode pembayaran:</b> QRIS`,
            `├──────────────────`,
            `│ ⬩ <b>Status:</b> DIBATALKAN`,
            `│ ⬩ <b>Tgl/jam:</b> ${waktuOrder}`,
            `╰──────────────────`
        ].join('\n');

        console.log("[INFO]", ctx.chat.id, `transaksi ${order.payment_reference} dibatalkan langsung in-place`);

        const brand = detectBrand(order.product_name);
        const brandKey = brand?.key || 'lainnya';

        const cancelKeyboard = Markup.inlineKeyboard([
            [Markup.button.callback("🔖 Kembali ke Variasi", `backInformasiVariasi:${brandKey}`)],
            [
                Markup.button.callback("📦 Katalog", "backInformasiOrderList"),
                Markup.button.callback("↩️ Menu Utama", "backInformasiUtama")
            ]
        ]);

        await ctx.deleteMessage().catch(() => { });
        await ctx.reply(textBatal, {
            parse_mode: "HTML",
            ...cancelKeyboard
        });
    } catch (err) {
        console.error("[ERROR] Terjadi kesalahan batalkan order ", err.message);
        await ctx.answerCbQuery("Gagal membatalkan pesanan.").catch(() => { });
    }
});

bot.action(/^backInformasiVariasi:([a-z0-9_-]+)$/, async (ctx) => {
    try {
        await ctx.answerCbQuery().catch(() => { });
        const brandKey = ctx.match[1];
        await halamanVarianKategori(ctx, brandKey, false);
    } catch (e) {
        console.error("[ERROR] Gagal kembali ke variasi:", e.message);
        await ctx.reply("Gagal menampilkan variasi produk.");
    }
});

bot.action("backInformasiUtama", async (ctx) => {
    try {
        await ctx.answerCbQuery().catch(() => { });
        try {
            await halamanUtama(ctx);
        } catch (e) {
            console.error(e.message);
        }
    } catch (e) {
        console.log(e.message);
    }
});
// ===============================================================================================

// ================================ auto cek pending & auto delivery ==============================
// 1. Penyerahan stok terpusat & transaksi database atomik (AGENTS.md Section 4.B)
async function processSuccessfulOrder(order, paidAt = null) {
    const client = await pool.connect();
    let deliveredStocks = [];
    let note = '-';
    let formattedAccountsText = '';

    try {
        await client.query('BEGIN');

        // Kunci baris stok yang tersedia dengan FOR UPDATE untuk mencegah overselling / tabrakan dengan web
        const stockRes = await client.query(`
            SELECT s.id, s.account_data, p.note AS product_note, p.name AS product_name, p.price AS product_price
            FROM stocks s
            JOIN products p ON s.product_id = p.id
            WHERE s.product_id = $1
            AND s.status = 'available'
            LIMIT $2
            FOR UPDATE
        `, [order.product_id, order.quantity]);

        if (stockRes.rows.length < order.quantity) {
            // Stok fisik kurang di database
            await client.query('ROLLBACK');
            console.error(`[CRITICAL] Stok tidak cukup untuk order ID #${order.id} (${order.payment_reference}). Butuh ${order.quantity}, tersedia ${stockRes.rows.length}`);

            await pool.query(`
                UPDATE orders
                SET status = 'paid', paid_at = COALESCE($1, NOW())
                WHERE id = $2
            `, [paidAt, order.id]);

            const alertMsg =
                `🚨 <b>STOK DEFISIT - PERLU RESTOCK SEGERA!</b>\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `Order ID: <code>#${order.id}</code> (Reff: <code>${order.payment_reference}</code>)\n` +
                `Produk: <code>${order.product_name || order.product_id}</code>\n` +
                `Kuantitas: <b>${order.quantity}</b> pcs\n` +
                `User ID: <code>${order.user_id}</code>\n` +
                `Status: Pembayaran LUNAS via QRIS. Harap segera tambah stok agar pesanan terkirim otomatis!`;
            await notifyAllAdmins(bot, alertMsg);

            if (order.telegram_id) {
                await bot.telegram.sendMessage(
                    order.telegram_id,
                    `✅ <b>Pembayaran Berhasil!</b>\n\nPembayaran Anda telah kami terima. Akun sedang dipersiapkan dan akan dikirimkan otomatis dalam beberapa saat. Terima kasih atas kesabarannya!`,
                    { parse_mode: "HTML" }
                ).catch(() => { });
            }
            return false;
        }

        deliveredStocks = stockRes.rows;
        note = deliveredStocks[0].product_note || '-';
        const stockIds = deliveredStocks.map(s => s.id);
        formattedAccountsText = deliveredStocks.map(s => s.account_data).join('\n');

        // Ubah status stok terpilih menjadi 'sold'
        await client.query(`
            UPDATE stocks
            SET status = 'sold', sold_at = NOW()
            WHERE id = ANY($1::bigint[])
        `, [stockIds]);

        // Update orders menjadi 'completed' dan simpan data akun
        await client.query(`
            UPDATE orders
            SET status = 'completed',
                paid_at = COALESCE($1, NOW()),
                completed_at = NOW(),
                data = $2
            WHERE id = $3
        `, [paidAt, formattedAccountsText, order.id]);

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[TRANSACTION ERROR] Gagal proses delivery order #${order.id}:`, err.message);
        return false;
    } finally {
        client.release();
    }

    // Hapus pesan QRIS lama jika masih ada
    if (order.telegram_id && order.message_id) {
        await bot.telegram.deleteMessage(order.telegram_id, order.message_id).catch(() => { });
    }

    // Kirim data akun ke pembeli Telegram
    const d = new Date(paidAt || Date.now());
    const waktuBayar = `${d.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Jakarta' })}, ${d.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: "2-digit", minute: "2-digit", hour12: false })} WIB`;

    const brand = detectBrand(order.product_name);
    const brandKey = brand?.key || 'lainnya';
    const fee = Math.max(0, Number(order.total) - (Number(order.product_price) * Number(order.quantity)));

    if (deliveredStocks.length > 2) {
        const barangList = deliveredStocks.map(item => `│ ⬩ ${item.account_data}`);
        const pecahbuffer = await pecahBarang(order, waktuBayar, barangList, note);

        const captionDoc = [
            `╭──────────────────`,
            `│ 🛒 <b>INFORMASI ORDER</b>`,
            `├──────────────────`,
            `│ ⬩ <b>Reff ID:</b> <code>${order.payment_reference}</code>`,
            `│ ⬩ <b>Produk:</b> <code>${order.product_name.toUpperCase()}</code>`,
            `│ ⬩ <b>Metode pembayaran:</b> QRIS`,
            `│ ⬩ <b>Harga:</b> Rp ${Number(order.product_price).toLocaleString('id-ID')}`,
            `│ ⬩ <b>Jumlah:</b> ${order.quantity}`,
            `│ ⬩ <b>Fee:</b> Rp ${fee.toLocaleString('id-ID')}`,
            `│ ⬩ <b>Total Bayar:</b> Rp ${Number(order.total).toLocaleString('id-ID')}`,
            `├──────────────────`,
            `│ ⬩ <b>Status:</b> SUKSES`,
            `│ ⬩ <b>Dibayar:</b> ${waktuBayar}`,
            `╰──────────────────\n`,
            `Detail akun pesanan Anda terlampir pada file di atas.`
        ].join('\n');

        await bot.telegram.sendDocument(order.telegram_id,
            {
                source: pecahbuffer,
                filename: `${order.telegram_id} - ${order.payment_reference} - SUCCESS.txt`
            },
            {
                caption: captionDoc,
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("🔖 Kembali ke Variasi", `backInformasiVariasi:${brandKey}`)],
                    [
                        Markup.button.callback("📦 Katalog", "backInformasiOrderList"),
                        Markup.button.callback("↩️ Menu Utama", "backInformasiUtama")
                    ]
                ])
            }
        ).catch((e) => console.error("Gagal kirim dokumen:", e.message));
    } else {
        const barangDikit = deliveredStocks.map(item => `│ ⬩ <code>${item.account_data}</code>`);
        const text = [
            `╭──────────────────`,
            `│ 🛒 <b>INFORMASI ORDER</b>`,
            `├──────────────────`,
            `│ ⬩ <b>Reff ID:</b> <code>${order.payment_reference}</code>`,
            `│ ⬩ <b>Produk:</b> <code>${order.product_name.toUpperCase()}</code>`,
            `│ ⬩ <b>Metode pembayaran:</b> QRIS`,
            `│ ⬩ <b>Harga:</b> Rp ${Number(order.product_price).toLocaleString('id-ID')}`,
            `│ ⬩ <b>Jumlah:</b> ${order.quantity}`,
            `│ ⬩ <b>Fee:</b> Rp ${fee.toLocaleString('id-ID')}`,
            `│ ⬩ <b>Total Bayar:</b> Rp ${Number(order.total).toLocaleString('id-ID')}`,
            `├──────────────────`,
            `│ ⬩ <b>Status:</b> SUKSES`,
            `│ ⬩ <b>Dibayar:</b> ${waktuBayar}`,
            `├──────────────────`,
            `│ 📦 <b>Data Akun:</b>`,
            `│`,
            `│ Note: ${note}`,
            `│`,
            ...barangDikit,
            `├──────────────────`,
            `│ <i>Terima kasih telah bertransaksi, semoga rezekinya lancar dan sehat selalu ✨</i>`,
            `╰──────────────────`
        ].join('\n');

        await bot.telegram.sendMessage(order.telegram_id, text, {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard([
                [Markup.button.callback("🔖 Kembali ke Variasi", `backInformasiVariasi:${brandKey}`)],
                [
                    Markup.button.callback("📦 Katalog", "backInformasiOrderList"),
                    Markup.button.callback("↩️ Menu Utama", "backInformasiUtama")
                ]
            ])
        }).catch((e) => console.error("Gagal kirim pesan akun:", e.message));
    }

    // Kirim notifikasi SUKSES ke Channel Monitoring
    const ordernya = {
        reffid: order.payment_reference,
        name: order.product_name.toUpperCase(),
        metode: "QRIS",
        harga: Number(order.product_price).toLocaleString('id-ID'),
        jumlah: order.quantity,
        fee: fee.toLocaleString('id-ID'),
        total: Number(order.total).toLocaleString('id-ID'),
        status: "SUKSES"
    };
    await sendNotifMonitoring(ordernya);
    console.log("[INFO]", Number(order.telegram_id), `transaksi ${order.payment_reference} SUKSES dan produk telah diserahkan.`);
    return true;
}

// 2. Cron cek order expired (tiap 5 detik)
let isCheckingExpired = false;
cron.schedule("*/5 * * * * *", async () => {
    if (isCheckingExpired) return;
    isCheckingExpired = true;
    try {
        const result = await pool.query(`
            UPDATE orders
            SET status = 'expired'
            WHERE status = 'pending'
            AND expires_at <= NOW()
            AND paid_at IS NULL
            AND message_id IS NOT NULL
            RETURNING id, message_id, payment_reference
        `);

        if (result.rows.length > 0) {
            for (const order of result.rows) {
                try {
                    const orderResult = await pool.query(`
                        SELECT 
                            orders.*,
                            products.name AS product_name,
                            products.price AS product_price,
                            users.telegram_id
                        FROM orders
                        JOIN products ON orders.product_id = products.id
                        JOIN users ON orders.user_id = users.id
                        WHERE orders.id = $1;
                    `, [order.id]);

                    if (orderResult.rows.length > 0) {
                        const dataOrder = orderResult.rows[0];

                        await bot.telegram.deleteMessage(dataOrder.telegram_id, dataOrder.message_id).catch(() => { });

                        const d = new Date(dataOrder.created_at);
                        const waktuOrder = `${d.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Jakarta' })}, ${d.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: "2-digit", minute: "2-digit", hour12: false })} WIB`;

                        const feeExpired = Math.max(0, Number(dataOrder.total) - (Number(dataOrder.product_price) * Number(dataOrder.quantity)));
                        const ordernya = {
                            reffid: dataOrder.payment_reference,
                            name: dataOrder.product_name.toUpperCase(),
                            metode: "QRIS",
                            harga: Number(dataOrder.product_price).toLocaleString('id-ID'),
                            jumlah: dataOrder.quantity,
                            fee: feeExpired.toLocaleString('id-ID'),
                            total: Number(dataOrder.total).toLocaleString('id-ID'),
                            status: "KADALUARSA"
                        };
                        await sendNotifMonitoring(ordernya);

                        const text = [
                            `╭──────────────────`,
                            `│ 🛒 <b>INFORMASI ORDER</b>`,
                            `├──────────────────`,
                            `│ ⬩ <b>Reff ID:</b> <code>${dataOrder.payment_reference}</code>`,
                            `│ ⬩ <b>Metode pembayaran:</b> QRIS`,
                            `├──────────────────`,
                            `│ ⬩ <b>Status:</b> KADALUARSA`,
                            `│ ⬩ <b>Tgl/jam:</b> ${waktuOrder}`,
                            `╰──────────────────`
                        ].join('\n');

                        const brand = detectBrand(dataOrder.product_name);
                        const brandKey = brand?.key || 'lainnya';

                        console.log("[INFO]", Number(dataOrder.telegram_id), `transaksi ${order.payment_reference} kadaluarsa dan telah diubah menjadi expired`);
                        await bot.telegram.sendMessage(dataOrder.telegram_id, text, {
                            parse_mode: "HTML",
                            ...Markup.inlineKeyboard([
                                [Markup.button.callback("🔖 Kembali ke Variasi", `backInformasiVariasi:${brandKey}`)],
                                [
                                    Markup.button.callback("📦 Katalog", "backInformasiOrderList"),
                                    Markup.button.callback("↩️ Menu Utama", "backInformasiUtama")
                                ]
                            ])
                        }).catch(() => { });
                    }
                } catch (e) {
                    console.error("[EXPIRE CRON ORDER ERROR]", e.message);
                }
            }
        }

        // Tandai juga pesanan pending web yang expired agar stok database otomatis bebas kembali
        await pool.query(`
            UPDATE orders
            SET status = 'expired'
            WHERE status = 'pending'
            AND expires_at <= NOW()
            AND paid_at IS NULL
            AND message_id IS NULL
        `).catch(() => { });
    } catch (err) {
        console.error("[EXPIRE CRON ERROR]", err.message);
    } finally {
        isCheckingExpired = false;
    }
});

// 3. Cron cek status pembayaran pending ke RamaShop (tiap 3 detik)
let isCheckingPending = false;
cron.schedule("*/3 * * * * *", async () => {
    if (isCheckingPending) return;
    isCheckingPending = true;
    try {
        const result = await pool.query(`
            SELECT 
                o.*,
                p.name AS product_name,
                p.price AS product_price,
                u.telegram_id
            FROM orders o
            JOIN products p ON o.product_id = p.id
            JOIN users u ON o.user_id = u.id
            WHERE (o.status = 'pending' OR (o.status = 'cancelled' AND o.created_at >= NOW() - INTERVAL '20 minutes' AND o.paid_at IS NULL))
            AND o.message_id IS NOT NULL
        `);

        if (result.rows.length > 0) {
            for (const order of result.rows) {
                if (orderSedangDiproses.has(order.id)) continue;

                const cekTX = await cekPayment(order.payment_reference);
                if (cekTX && cekTX.data) {
                    if (cekTX.data.status === "pending") {
                        // Belum dibayar
                    } else if (cekTX.data.status === "success") {
                        orderSedangDiproses.add(order.id);
                        try {
                            await processSuccessfulOrder(order, cekTX.data.paidAt);
                        } catch (err) {
                            console.error("[PROCESS SUCCESS ERROR]", err.message);
                        } finally {
                            orderSedangDiproses.delete(order.id);
                        }
                    } else if (cekTX.data.status === "expired" && order.status === "pending") {
                        // Gateway menyatakan expired: majukan expires_at agar segera ditangani oleh Cron 2 (hapus pesan QRIS, notif user & channel)
                        await pool.query(`
                            UPDATE orders
                            SET expires_at = NOW() - INTERVAL '1 second'
                            WHERE id = $1 AND status = 'pending'
                        `, [order.id]);
                    }
                }
            }
        }
    } catch (err) {
        console.error("[CRON CHECK PENDING ERROR]", err.message);
    } finally {
        isCheckingPending = false;
    }
});

// 4. Cron pemrosesan retry order yang berstatus 'paid' (misal: jika baru direstock admin)
let isCheckingPaid = false;
cron.schedule("*/3 * * * * *", async () => {
    if (isCheckingPaid) return;
    isCheckingPaid = true;
    try {
        const orderResult = await pool.query(`
            SELECT 
                o.*, 
                p.name AS product_name,
                p.price AS product_price,
                u.telegram_id
            FROM orders o
            JOIN products p ON o.product_id = p.id
            JOIN users u ON o.user_id = u.id
            WHERE o.status = 'paid'
            AND o.completed_at IS NULL
            AND o.message_id IS NOT NULL;
        `);

        if (orderResult.rows.length > 0) {
            for (const order of orderResult.rows) {
                if (orderSedangDiproses.has(order.id)) continue;
                orderSedangDiproses.add(order.id);
                try {
                    await processSuccessfulOrder(order, order.paid_at);
                } catch (e) {
                    console.error("[CRON RETRY PAID ERROR]", e.message);
                } finally {
                    orderSedangDiproses.delete(order.id);
                }
            }
        }
    } catch (e) {
        console.error("[CRON PAID ERROR]", e.message);
    } finally {
        isCheckingPaid = false;
    }
});

// 5. Cron auto-clean sesi kadaluarsa di bot_sessions (tiap hari Minggu jam 03.00 WIB)
cron.schedule("0 3 * * 0", async () => {
    try {
        const delRes = await pool.query(`DELETE FROM bot_sessions WHERE updated_at < NOW() - INTERVAL '7 days'`);
        if (delRes.rowCount > 0) {
            console.log(`[CRON] Auto-clean: ${delRes.rowCount} sesi lama (> 7 hari) berhasil dibersihkan.`);
        }
    } catch (err) {
        console.error("[CRON CLEAN SESSIONS ERROR]", err.message);
    }
});

async function pecahBarang(order, waktuBayar, arrayBarang, note) {
    const formattedAccounts = arrayBarang.map(acc => `${acc.trim()}`).join('\n');
    const fee = Math.max(0, Number(order.total) - (Number(order.product_price) * Number(order.quantity)));
    const fileContent = [
        `╭──────────────────`,
        `│ 🛒 INFORMASI ORDER`,
        `├──────────────────`,
        `│ ⬩ Reff ID: ${order.payment_reference}`,
        `│ ⬩ Produk: ${order.product_name.toUpperCase()}`,
        `│ ⬩ Metode pembayaran: QRIS`,
        `│ ⬩ Harga: Rp ${Number(order.product_price).toLocaleString('id-ID')}`,
        `│ ⬩ Jumlah: ${order.quantity}`,
        `│ ⬩ Fee: Rp ${fee.toLocaleString('id-ID')}`,
        `│ ⬩ Total Bayar: Rp ${Number(order.total).toLocaleString('id-ID')}`,
        `├──────────────────`,
        `│ ⬩ Status: SUKSES`,
        `│ ⬩ Dibayar: ${waktuBayar}`,
        `├──────────────────`,
        `│ 📦 Data Akun:`,
        `│`,
        `│ Note: ${note}`,
        `│`,
        formattedAccounts,
        `├──────────────────`,
        `│ Terima kasih telah bertransaksi, semoga rezekinya lancar dan sehat selalu ✨`,
        `╰──────────────────`
    ].join('\n');

    return Buffer.from(fileContent, 'utf-8');
}

// =================================================================================================

// ========================================= Global error handling =================================
// ======================== GLOBAL ERROR HANDLER TELEGRAF ========================
bot.catch(async (err, ctx) => {
    console.error(`[TELEGRAF ERROR] Context update type: ${ctx.updateType}`, err);

    const errorMessage = err.message || JSON.stringify(err);
    const userId = ctx.from ? ctx.from.id : 'Unknown';
    const username = ctx.from && ctx.from.username ? `@${ctx.from.username}` : 'No Username';

    // 1. Respon ramah ke User
    try {
        if (ctx.callbackQuery) {
            await ctx.answerCbQuery("⚠️ Terjadi kesalahan sistem. Admin telah dinotifikasi.").catch(() => { });
        } else {
            await ctx.reply("❌ Terjadi kesalahan pada sistem. Silakan coba beberapa saat lagi.").catch(() => { });
        }
    } catch (e) {
        // Abaikan jika user memblokir bot
    }

    // 2. Kirim laporan error ke SEMUA Admin
    const notifAdmin = [
        `🚨 <b>BOT ERROR DETECTED</b>`,
        `━━━━━━━━━━━━━━━━━━━━`,
        `👤 <b>User:</b> ${username} (<code>${userId}</code>)`,
        `📡 <b>Update Type:</b> <code>${ctx.updateType}</code>`,
        `⚠️ <b>Error Message:</b>`,
        `<code>${errorMessage.substring(0, 1000)}</code>`,
        `━━━━━━━━━━━━━━━━━━━━`,
        `⏰ <b>Waktu:</b> ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB`
    ].join('\n');

    await notifyAllAdmins(bot, notifAdmin);
});

async function notifyAllAdmins(bot, message, options = {}) {
    const adminList = (process.env.USER_ID_ADMIN || '')
        .split(',')
        .map(id => id.trim());

    for (const adminId of adminList) {
        if (adminId) {
            try {
                await bot.telegram.sendMessage(adminId, message, { parse_mode: 'HTML', ...options });
            } catch (err) {
                console.error(`[ERROR] Gagal kirim notif ke Admin ID ${adminId}:`, err.message);
            }
        }
    }
}
// ====================================================================================================

// ================================================ Jalankan bot launch =============================
bot.launch()
console.log("🤖 Bot sedang berjalan...")

export { apaAdmin, checkProdukPending, checkStokAvailable }
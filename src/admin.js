import { Markup, session, Telegraf } from 'telegraf';
import { pool } from './database.js';
import { apaAdmin, checkProdukPending, checkStokAvailable } from './bot.js';

function adminSetup(bot) {
    // ========================================= ADMIN PANEL ==========================================
    async function menuAdmin(ctx) {
        try {
            const adminCek = await apaAdmin(ctx)
            if (!adminCek) return;

            if (ctx.session) delete ctx.session.adminAction;

            await ctx.reply("⚙️ <b>PANEL ADMIN</b>\n━━━━━━━━━━━━━━━━━━━━\nSelamat datang di pusat kendali bot. Silakan pilih menu di bawah ini untuk mengelola sistem:",
                {
                    parse_mode: "html",
                    ...Markup.inlineKeyboard([
                        [
                            Markup.button.callback("📦 Kelola Produk", "kelolaProduk"),
                            Markup.button.callback("📥 Kelola Stok", "kelolaStok")
                        ],
                        [
                            Markup.button.callback("📢 Broadcast", "broadcast"),
                            Markup.button.callback("👥 Manage User", "manageUser")
                        ],
                        [
                            Markup.button.callback("📊 Statistik", "admin_stats"),
                            Markup.button.callback("🔎 Cari Order", "admin_search_order")
                        ],
                        [
                            Markup.button.callback("🔥 Produk Terlaris", "admin_top_terlaris")
                        ]
                    ])
                }
            )
        } catch (err) {
            console.log("[ERROR] Gagal menampilkan panel admin", err.message)
        }
    }

    bot.command("admin", async (ctx) => {
        await menuAdmin(ctx)
    })

    bot.action("broadcast", async (ctx) => {
        try {
            await ctx.answerCbQuery().catch(() => { });
            // 🔴 1.Bersihkan session aksi admin di sini!
            if (ctx.session) {
                delete ctx.session.adminAction; // atau ctx.session.adminAction = null;
            }

            ctx.session.adminAction = "waiting_broadcast_text";
            // console.log(ctx.session.adminAction)

            const textPrompt =
                "📢 <b>KIRIM BROADCAST</b>\n" +
                "━━━━━━━━━━━━━━━━━━━━\n" +
                "Silakan tulis pesan/pengumuman yang ingin disebarkan ke seluruh pengguna bot.\n\n" +
                "<blockquote><code><b>📢 BROADCAST MESSAGE / ✅ INFORMASI RESTOCK</b>\n\n" +
                "Selamat pagi pelanggan setia! 👋\n" +
                "Stok beberapa produk favorit sudah diisi kembali, silakan amankan pesananmu: / PRODUK RESTOCK READY ⚡️\n\n" +
                "───────────────\n" +
                "◉ AI Gemini Advanced\n" +
                "◉ Alight Motion Pro\n" +
                "◉ Apple Music\n" +
                "◉ Bstation Premium\n" +
                "───────────────\n\n" +
                "💡 Ketik /start untuk mulai transaksi\n\n" +
                "🤖 <b>Order via bot:</b> @bot_username\n" +
                "💬 <b>Admin CS:</b> @admin_username\n" +
                "📢 <b>Channel:</b> @channel_username\n" +
                "───────────────\n\n" +
                "Segera checkout sebelum kehabisan.\n" +
                "Terima kasih & selamat berbelanja ✨" +
                "</code></blockquote>" + "\n\n" +
                "💡 <i>Dukungan format HTML (bold, italic, link) dan pesan teks biasa.</i>";

            await ctx.editMessageText(textPrompt, {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("❌ Batal", "back_to_admin")]
                ])
            });

        } catch (err) {
            console.log("Gagal memulai broadcast:", err.message);
        }
        // try {
        //     await ctx.answerCbQuery().catch(() => {})
        //     await ctx.editMessageText(`📢 <b>BROADCAST</b>\n━━━━━━━━━━━━━━━━━━━━\nHalaman ini masih <i>under construction</i>.`, {
        //         parse_mode: 'HTML',
        //         ...Markup.inlineKeyboard([Markup.button.callback("⬅️ Kembali", "back_to_admin")])
        //     })
        // } catch (err) {
        //     console.log("[ERROR] Gagal ke menu broadcast", err.message)
        // }
    })

    bot.action("broadcast_execute", async (ctx) => {
        try {
            await ctx.answerCbQuery().catch(() => { });

            if (!ctx.session || !ctx.session.broadcastContent) {
                return await ctx.reply("⚠️ Sesi broadcast telah kadaluwarsa.")
            }

            const messageText = ctx.session.broadcastContent;
            delete ctx.session.broadcastContent

            await ctx.editMessageText("⏳ Sedang mengirimkan broadcast...", { parse_mode: "HTML" });

            // Ambil seluruh Telegram ID pengguna Bot (hanya ID asli Telegram > 0)
            const usersRes = await pool.query("SELECT telegram_id FROM users WHERE telegram_id > 0");
            const users = usersRes.rows;

            let successCount = 0;
            let adminCount = 0;
            let failCount = 0;

            for (const user of users) {
                try {
                    await ctx.telegram.sendMessage(user.telegram_id, messageText, { parse_mode: "HTML" });
                    successCount++;
                } catch (err) {
                    // User memblokir bot atau akun dihapus
                    failCount++;
                }
                // Delay tipis (50ms) untuk mencegah pembatasan rate limit dari Telegram API
                await new Promise((resolve) => setTimeout(resolve, 50));
            }

            const textReport =
                "✅ <b>BROADCAST SELESAI</b>\n" +
                "━━━━━━━━━━━━━━━━━━━━\n" +
                "🟢 <b>Berhasil Terkirim:</b> " + successCount + " pengguna\n" +
                "🔴 <b>Gagal (Bot Diblokir):</b> " + failCount + " pengguna\n" +
                "🤖 <b>Admin (Tidak Dikirim):</b> " + adminCount + " pengguna\n" +
                "📊 <b>Total Diproses:</b> " + users.length + " pengguna\n" +
                "━━━━━━━━━━━━━━━━━━━━";

            await ctx.editMessageText(textReport, {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("↩️ Kembali ke Menu Admin", "back_to_admin")]
                ])
            });
        } catch (err) {
            console.log("Gagal mengeksekusi broadcast:", err.message);
        }
    });

    bot.action("manageUser", async (ctx) => {
        try {
            await ctx.answerCbQuery().catch(() => { });

            // 1. Ambil statistik total user & user aktif
            const statsRes = await pool.query(
                "SELECT " +
                "COUNT(id) AS total_user, " +
                "COUNT(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN 1 END) AS active_recent " +
                "FROM users"
            );
            const totalUser = statsRes.rows[0].total_user || 0;
            const activeRecent = statsRes.rows[0].active_recent || 0;

            // 2. Ambil 5 user pendaftaran terbaru
            const latestUsersRes = await pool.query(
                "SELECT telegram_id, username, first_name, created_at " +
                "FROM users ORDER BY id DESC LIMIT 5"
            );

            let userListText = "";
            if (latestUsersRes.rows.length > 0) {
                userListText = latestUsersRes.rows.map((u, i) => {
                    const name = u.first_name ? u.first_name : "User";
                    const uname = u.username ? "@" + u.username : "@";
                    return (i + 1) + ". <code>" + name + "</code> (<code>" + uname + "</code>) - <code>" + u.telegram_id + "</code>";
                }).join("\n");
            } else {
                userListText = "<i>Belum ada pengguna terdaftar.</i>";
            }

            const textMessage =
                "👥 <b>MANAJEMEN USER</b>\n" +
                "━━━━━━━━━━━━━━━━━━━━\n" +
                "📊 <b>Total User:</b> " + totalUser + " pengguna\n" +
                "🔥 <b>Aktif 30 Hari Terakhir:</b> " + activeRecent + " pengguna\n" +
                "━━━━━━━━━━━━━━━━━━━━\n" +
                "🆕 <b>5 Pengguna Terbaru:</b>\n" +
                userListText + "\n" +
                "━━━━━━━━━━━━━━━━━━━━\n" +
                "<i>Gunakan tombol di bawah untuk tindakan lebih lanjut.</i>";

            await ctx.editMessageText(textMessage, {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([Markup.button.callback("⬅️ Kembali", "back_to_admin")])
            });

        } catch (err) {
            console.log("Gagal memuat manage user:", err.message);
        }
    })

    bot.action("kelolaProduk", async (ctx) => {
        try {
            await ctx.answerCbQuery().catch(() => { })

            // 🔴 1.Bersihkan session aksi admin di sini!
            if (ctx.session) {
                delete ctx.session.adminAction; // atau ctx.session.adminAction = null;
            }

            await ctx.editMessageText(`📦 <b>KELOLA PRODUK</b>\n━━━━━━━━━━━━━━━━━━━━\nSilakan pilih tindakan yang ingin dilakukan pada katalog produk:`, {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    [
                        Markup.button.callback("➕ Tambah", "produk_tambah"),
                        Markup.button.callback("✏️ Edit", "produk_edit"),
                    ],
                    [
                        Markup.button.callback("⬅️ Kembali", "back_to_admin")
                    ]
                ])
            })
        } catch (err) {
            console.error('Gagal mengedit pesan kelola produk:', err.message);
        }
    })

    bot.action("back_to_admin", async (ctx) => {
        try {
            await ctx.answerCbQuery().catch(() => { })

            if (ctx.session) {
                delete ctx.session.adminAction; // atau ctx.session.adminAction = null;
            }

            await ctx.editMessageText("⚙️ <b>PANEL ADMIN</b>\n━━━━━━━━━━━━━━━━━━━━\nSelamat datang di pusat kendali bot. Silakan pilih menu di bawah ini untuk mengelola sistem:",
                {
                    parse_mode: "html",
                    ...Markup.inlineKeyboard([
                        [
                            Markup.button.callback("📦 Kelola Produk", "kelolaProduk"),
                            Markup.button.callback("📥 Kelola Stok", "kelolaStok")
                        ],
                        [
                            Markup.button.callback("📢 Broadcast", "broadcast"),
                            Markup.button.callback("👥 Manage User", "manageUser")
                        ],
                        [
                            Markup.button.callback("📊 Statistik", "admin_stats"),
                            Markup.button.callback("🔎 Cari Order", "admin_search_order")
                        ],
                        [
                            Markup.button.callback("🔥 Produk Terlaris", "admin_top_terlaris")
                        ]
                    ])
                }
            )
        } catch (err) {
            console.log("[ERROR] Gagal menampilkan panel admin", err.message)
        }
    })

    async function renderEditProdukList(ctx, page = 0) {
        try {
            const result = await pool.query(`
                SELECT *
                FROM products 
                ORDER BY LOWER(name) ASC, id ASC
            `);

            if (result.rows.length === 0) {
                return await ctx.editMessageText(`✏️ <b>EDIT PRODUK</b>\n━━━━━━━━━━━━━━━━━━━━\nTidak ada produk yang bisa diedit.`, {
                    parse_mode: 'HTML',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback("⬅️ Kembali", "kelolaProduk")]
                    ])
                });
            }

            const produk = result.rows;
            const item_per_halaman = Number(process.env.ITEM_PER_HALAMAN) || 10;
            const totalPages = Math.ceil(produk.length / item_per_halaman);
            const currentPage = Math.max(0, Math.min(page, totalPages - 1));

            if (!ctx.session) ctx.session = {};
            ctx.session.editProdukPage = currentPage;

            const start = currentPage * item_per_halaman;
            const end = start + item_per_halaman;
            const currentProducts = produk.slice(start, end);

            let textList = `✏️ <b>EDIT PRODUK</b>\n━━━━━━━━━━━━━━━━━━━━\n`;
            currentProducts.forEach((p, idx) => {
                const globalNumber = start + idx + 1;
                const status = p.active ? "✅" : "❌";
                const priceFormatted = Number(p.price).toLocaleString("id-ID");
                textList += `<b>[${globalNumber}]</b> ${p.name}\n└ ID: ${p.id} • Rp ${priceFormatted} • ${status}\n\n`;
            });

            textList += `━━━━━━━━━━━━━━━━━━━━\n`;
            textList += `📄 Halaman: ${currentPage + 1} / ${totalPages}\n\n`;
            textList += `<i>Keterangan: ✅ Aktif | ❌ Nonaktif</i>\n`;
            textList += `<i>Klik nomor produk di bawah untuk mengedit:</i>`;

            // Tombol nomor produk (maksimal 5 per baris, contoh 1-5 lalu 6-10, page 2 11-15 lalu 16-20)
            const allButton = [];
            const kolomPerBaris = 5;
            for (let i = 0; i < currentProducts.length; i += kolomPerBaris) {
                const rowBaris = [];
                for (let j = i; j < i + kolomPerBaris && j < currentProducts.length; j++) {
                    const globalNumber = start + j + 1;
                    const p = currentProducts[j];
                    rowBaris.push(Markup.button.callback(`${globalNumber}`, `editProduk:${p.id}`));
                }
                allButton.push(rowBaris);
            }

            // Tombol navigasi Previous & Next
            const navRow = [];
            if (currentPage > 0) {
                navRow.push(Markup.button.callback("◀️ Sebelumnya", `editProdukPage:${currentPage - 1}`));
            }
            if (currentPage < totalPages - 1) {
                navRow.push(Markup.button.callback("▶️ Berikutnya ", `editProdukPage:${currentPage + 1}`));
            }
            if (navRow.length > 0) {
                allButton.push(navRow);
            }

            allButton.push([Markup.button.callback("⬅️ Kembali", "kelolaProduk")]);

            await ctx.editMessageText(textList, {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard(allButton)
            });
        } catch (err) {
            console.error("[ERROR] Gagal mengambil data edit produk:", err.message);
        }
    }

    async function renderStokProdukList(ctx, mode, page = 0) {
        const configs = {
            tambah: {
                title: "📥 <b>ISI STOK PRODUK</b>",
                hint: "Klik nomor produk di bawah untuk memasukkan stok baru.",
                prefix: "process_stok_tambah",
                pageAction: "stokTambahPage",
                sessionKey: "stokTambahPage"
            },
            hapus: {
                title: "🗑️ <b>HAPUS STOK PRODUK</b>",
                hint: "Klik nomor produk di bawah untuk menghapus seluruh stok tersedia.",
                prefix: "process_stok_hapus",
                pageAction: "stokHapusPage",
                sessionKey: "stokHapusPage"
            },
            ambil: {
                title: "📤 <b>AMBIL STOK PRODUK</b>",
                hint: "Klik nomor produk di bawah untuk mengambil data stok.",
                prefix: "process_stok_ambil",
                pageAction: "stokAmbilPage",
                sessionKey: "stokAmbilPage"
            }
        };

        const cfg = configs[mode];
        if (!cfg) return;

        try {
            const result = await pool.query(`
                SELECT 
                    p.id, 
                    p.name,
                    COUNT(CASE WHEN s.status = 'available' THEN 1 END) AS available_count
                FROM products p
                LEFT JOIN stocks s ON p.id = s.product_id
                WHERE p.active = TRUE
                GROUP BY p.id, p.name
                ORDER BY LOWER(p.name) ASC, p.id ASC
            `);

            if (result.rows.length === 0) {
                return await ctx.editMessageText(`${cfg.title}\n━━━━━━━━━━━━━━━━━━━━\nTidak ada produk aktif yang tersedia.`, {
                    parse_mode: 'HTML',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback("⬅️ Kembali", "kelolaStok")]
                    ])
                });
            }

            const produk = result.rows;
            const item_per_halaman = Number(process.env.ITEM_PER_HALAMAN) || 10;
            const totalPages = Math.ceil(produk.length / item_per_halaman);
            const currentPage = Math.max(0, Math.min(page, totalPages - 1));

            if (!ctx.session) ctx.session = {};
            ctx.session[cfg.sessionKey] = currentPage;

            const start = currentPage * item_per_halaman;
            const end = start + item_per_halaman;
            const currentProducts = produk.slice(start, end);

            let textList = `${cfg.title}\n━━━━━━━━━━━━━━━━━━━━\n`;
            currentProducts.forEach((p, idx) => {
                const globalNumber = start + idx + 1;
                textList += `<b>[${globalNumber}]</b> ${p.name}\n└ ID: ${p.id} • Stok: ${p.available_count}\n\n`;
            });

            textList += `━━━━━━━━━━━━━━━━━━━━\n`;
            textList += `📄 Halaman: ${currentPage + 1} / ${totalPages}\n\n`;
            textList += `<i>${cfg.hint}</i>`;

            // Tombol nomor produk (maksimal 5 per baris, contoh 1-5 lalu 6-10, page 2 11-15 lalu 16-20)
            const allButton = [];
            const kolomPerBaris = 5;
            for (let i = 0; i < currentProducts.length; i += kolomPerBaris) {
                const rowBaris = [];
                for (let j = i; j < i + kolomPerBaris && j < currentProducts.length; j++) {
                    const globalNumber = start + j + 1;
                    const p = currentProducts[j];
                    rowBaris.push(Markup.button.callback(`${globalNumber}`, `${cfg.prefix}:${p.id}`));
                }
                allButton.push(rowBaris);
            }

            // Tombol navigasi Previous & Next
            const navRow = [];
            if (currentPage > 0) {
                navRow.push(Markup.button.callback("◀️ Sebelumnya", `${cfg.pageAction}:${currentPage - 1}`));
            }
            if (currentPage < totalPages - 1) {
                navRow.push(Markup.button.callback("▶️ Berikutnya ", `${cfg.pageAction}:${currentPage + 1}`));
            }
            if (navRow.length > 0) {
                allButton.push(navRow);
            }

            allButton.push([Markup.button.callback("⬅️ Kembali", "kelolaStok")]);

            await ctx.editMessageText(textList, {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard(allButton)
            });
        } catch (err) {
            console.error(`[ERROR] Gagal render stok produk list (${mode}):`, err.message);
        }
    }

    bot.action(/^produk_(.+)$/, async (ctx) => {
        try {
            await ctx.answerCbQuery().catch(() => { })

            const aksi = ctx.match[1]; // ambil setelah produk_xxx
            // console.log(aksi)
            if (aksi === "tambah") {
                // Set session untuk menangani input teks selanjutnya
                ctx.session.adminAction = "add_product_name";
                // console.log(ctx.session.adminAction) //////////////////////////////////////////////////

                await ctx.editMessageText(`➕ <b>TAMBAH PRODUK</b>\n━━━━━━━━━━━━━━━━━━━━\nSilakan masukkan <b>Nama Produk</b> yang ingin ditambahkan:\n\n💡 Contoh: <code>Netflix 1P1U 1 Bulan</code>`, {
                    parse_mode: 'HTML',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback("❌ Batal", "kelolaProduk")]
                    ])
                })
            } else if (aksi === "edit") {
                await renderEditProdukList(ctx, 0);
            }
        } catch (err) {
            console.log("[ERROR] Gagal menampilkan kelola produk", err.message)
        }
    })

    bot.action(/^editProduk:(\d+)$/, async (ctx) => {
        const productId = ctx.match[1];
        // console.log(productId)

        try {
            // Ambil detail lengkap produk beserta catatan
            const result = await pool.query(`
                SELECT *
                FROM products
                WHERE id = $1
            `, [productId]
            );

            const produk = result.rows[0]
            if (!produk) {
                return await ctx.answerCbQuery("⚠️ Produk tidak ditemukan.", { show_alert: true }).catch(() => { })
            }

            await ctx.answerCbQuery().catch(() => { })

            const priceFormatted = Number(produk.price).toLocaleString("id-ID")
            const statusText = produk.active ? "✅ Aktif" : "❌ Nonaktif"

            const captionText =
                `⚙️ <b>EDIT PRODUK ID: ${produk.id}</b>\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `📌 <b>Nama:</b> ${produk.name}\n` +
                `💰 <b>Harga:</b> Rp ${priceFormatted}\n` +
                `📝 <b>Deskripsi:</b> <code>${produk.description}</code>\n` +
                `📜 <b>Catatan:</b> <code>${produk.note}</code>\n` +
                `🔘 <b>Status:</b> ${statusText}\n\n` +
                `<i>Pilih bagian yang ingin diperbarui:</i>`;

            // Tampilkan menu pilihan opsi edit
            await ctx.editMessageText(captionText, {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    [
                        Markup.button.callback("✏️ Edit Nama", `editField:name:${productId}`),
                        Markup.button.callback("💰 Edit Harga", `editField:price:${productId}`)
                    ],
                    [
                        Markup.button.callback("📝 Edit Deskripsi", `editField:description:${productId}`),
                        Markup.button.callback("📜 Edit Catatan", `editField:note:${productId}`),
                    ],
                    [Markup.button.callback(produk.active ? "🔴 Nonaktifkan" : "🟢 Aktifkan", `toggleActiveProduk:${productId}`)],
                    [Markup.button.callback("⬅️ Kembali ke Daftar Edit", "editProdukList")]
                ])
            })
        } catch (err) {
            console.log("[ERROR] Gagal edit detail produk", err.message);
        }
    })

    bot.action(/^editField:(name|price|description|note):(\d+)$/, async (ctx) => {
        const field = ctx.match[1];
        const productId = ctx.match[2];

        try {
            await ctx.answerCbQuery().catch(() => { });

            // Simpan context edit ke dalam session admin
            ctx.session.adminAction = "waiting_product_update";
            // console.log(ctx.session.adminAction)
            ctx.session.editContext = {
                productId: productId,
                field: field,
                messageId: ctx.callbackQuery.message.message_id
            };

            const fieldLabels = {
                name: "Nama Produk",
                price: "Harga Produk",
                description: "Deskripsi Produk (input '-' jika kosong)",
                note: "Catatan Produk (input '-' jika kosong)"
            };

            const promptMessage =
                `✏️ <b>EDIT ${fieldLabels[field].toUpperCase()}</b>\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `Silakan kirimkan nilai baru untuk <b>${fieldLabels[field]}</b> melalui pesan chat ini.\n\n`

            await ctx.editMessageText(promptMessage, {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("❌ Batal", `editProduk:${productId}`)]
                ])
            });

        } catch (err) {
            console.error("[ERROR] Gagal memproses edit field", err.message);
        }
    });

    bot.action("editProdukList", async (ctx) => {
        try {
            await ctx.answerCbQuery().catch(() => { });

            // 1. Reset state adminAction jika sebelumnya berada dalam status antrean edit
            if (ctx.session) {
                ctx.session.editContext = null;
            }

            const currentPage = ctx.session?.editProdukPage || 0;
            await renderEditProdukList(ctx, currentPage);
        } catch (err) {
            console.log("[ERROR] Gagal kembali ke edit produk list", err.message);
        }
    });

    bot.action(/^editProdukPage:(\d+)$/, async (ctx) => {
        try {
            await ctx.answerCbQuery().catch(() => { });
            const targetPage = parseInt(ctx.match[1], 10);
            await renderEditProdukList(ctx, targetPage);
        } catch (err) {
            console.error("[ERROR] Gagal navigasi halaman edit produk:", err.message);
        }
    });

    bot.action(/^toggleActiveProduk:(\d+)$/, async (ctx) => {
        const productId = ctx.match[1];

        try {
            // 1. Switch/toggle status active di PostgreSQL (TRUE <-> FALSE)
            const updateResult = await pool.query(`
                UPDATE products 
                SET active = NOT active
                WHERE id = $1 
                RETURNING active
            `, [productId]);

            if (updateResult.rowCount === 0) {
                return await ctx.answerCbQuery("⚠️ Produk tidak ditemukan.", { show_alert: true }).catch(() => { });
            }
            await ctx.answerCbQuery().catch(() => { });

            // 2. Ambil ulang data detail produk terbaru
            const result = await pool.query(`
                SELECT *
                FROM products
                WHERE id = $1
            `, [productId])

            const produk = result.rows[0];
            const priceFormatted = Number(produk.price).toLocaleString("id-ID");
            const statusText = produk.active ? "✅ Aktif" : "❌ Nonaktif";

            const captionText =
                `⚙️ <b>EDIT PRODUK ID: ${produk.id}</b>\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `📌 <b>Nama:</b> ${produk.name}\n` +
                `💰 <b>Harga:</b> Rp ${priceFormatted}\n` +
                `📝 <b>Deskripsi:</b> <code>${produk.description}</code>\n` +
                `📜 <b>Catatan:</b> <code>${produk.note}</code>\n` +
                `🔘 <b>Status:</b> ${statusText}\n\n` +
                `<i>Pilih bagian yang ingin diperbarui:</i>`;

            // 3. Edit pesan dengan tombol status toggle yang diperbarui
            await ctx.editMessageText(captionText, {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    [
                        Markup.button.callback("✏️ Edit Nama", `editField:name:${productId}`),
                        Markup.button.callback("💰 Edit Harga", `editField:price:${productId}`)
                    ],
                    [
                        Markup.button.callback("📝 Edit Deskripsi", `editField:description:${productId}`),
                        Markup.button.callback("📜 Edit Catatan", `editField:note:${productId}`),
                    ],
                    [Markup.button.callback(produk.active ? "🔴 Nonaktifkan" : "🟢 Aktifkan", `toggleActiveProduk:${productId}`)],
                    [Markup.button.callback("⬅️ Kembali ke Daftar Edit", "editProdukList")]
                ])
            });
        } catch (err) {
            console.log("[ERROR] Gagal toggle active", err.message);
        }
    });


    bot.action(/^konfirmasiTambahProduk_(ya|tidak)$/, async (ctx) => {
        try {
            await ctx.answerCbQuery().catch(() => { });
            const pilihan = ctx.match[1] // ambil ya atau tidak

            if (pilihan === "ya") {
                const { productName, productPrice, productDescription, productNote } = ctx.session || {};

                if (!productName || !productPrice) {
                    return await ctx.reply("❌ Data produk tidak lengkap di session. Silakan coba lagi.");
                }

                await pool.query(
                    `INSERT INTO products (name, price, description, note) VALUES ($1, $2, $3, $4)`,
                    [productName, productPrice, productDescription, productNote]
                );

                // Clean semua session
                if (ctx.session) {
                    delete ctx.session.adminAction;
                    delete ctx.session.productName;
                    delete ctx.session.productPrice;
                    delete ctx.session.productDescription;
                    delete ctx.session.productNote;
                }

                await ctx.editMessageText(`✅ Produk berhasil ditambahkan!`,
                    {
                        parse_mode: 'HTML',
                        ...Markup.inlineKeyboard([
                            [Markup.button.callback("➕ Tambah Lagi", "produk_tambah")],
                            [Markup.button.callback("⬅️ Kembali", "kelolaProduk")]
                        ])
                    }
                )

            } else {
                // Batal
                if (ctx.session) {
                    delete ctx.session.adminAction;
                    delete ctx.session.productName;
                    delete ctx.session.productPrice;
                    delete ctx.session.productDescription;
                    delete ctx.session.productNote;
                }

                await ctx.editMessageText(` ❌ Penambahan produk dibatalkan.`,
                    {
                        parse_mode: 'HTML',
                        ...Markup.inlineKeyboard([
                            [Markup.button.callback("➕ Tambah Produk Lain", "produk_tambah")],
                            [Markup.button.callback("⬅️ Kembali ke Kelola Produk", "kelolaProduk")]
                        ])
                    }
                )
            }
        } catch (err) {
            console.error("[ERROR] Error konfirmasi tambah produk", err.message);
        }
    })

    bot.action("kelolaStok", async (ctx) => {
        try {
            await ctx.answerCbQuery().catch(() => { })

            // 🔴 1.Bersihkan session aksi admin di sini!
            if (ctx.session) {
                delete ctx.session.adminAction; // atau ctx.session.adminAction = null;
                delete ctx.session.stockContext;
            }

            await ctx.editMessageText(`📥 <b>KELOLA STOK</b>\n━━━━━━━━━━━━━━━━━━━━\nSilakan pilih tindakan yang ingin dilakukan pada katalog stok:`, {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    [
                        Markup.button.callback("➕ Isi Stok", "stok_tambah"),
                        Markup.button.callback("🗑️ Hapus", "stok_hapus"),
                    ],
                    [Markup.button.callback("📤 Ambil Stok", "stok_ambil")],
                    [
                        Markup.button.callback("⬅️ Kembali", "back_to_admin")
                    ]
                ])
            })
        } catch (err) {
            console.error('Gagal mengedit pesan kelola produk:', err.message);
        }
    })

    bot.action("stok_tambah", async (ctx) => {
        try {
            await ctx.answerCbQuery().catch(() => { });
            const page = ctx.session?.stokTambahPage || 0;
            await renderStokProdukList(ctx, 'tambah', page);
        } catch (err) {
            console.error("[ERROR] Gagal membuka stok tambah:", err.message);
        }
    });

    bot.action(/^stokTambahPage:(\d+)$/, async (ctx) => {
        try {
            await ctx.answerCbQuery().catch(() => { });
            const targetPage = parseInt(ctx.match[1], 10);
            await renderStokProdukList(ctx, 'tambah', targetPage);
        } catch (err) {
            console.error("[ERROR] Gagal navigasi stok tambah page:", err.message);
        }
    });

    bot.action(/^process_stok_tambah:(\d+)$/, async (ctx) => {
        const productId = ctx.match[1];

        try {
            // 1. Validasi keberadaan produk di PostgreSQL
            const result = await pool.query(
                `SELECT id, name FROM products WHERE id = $1 AND active = TRUE`,
                [productId]
            );
            const product = result.rows[0];

            if (!product) {
                return await ctx.answerCbQuery("⚠️ Produk tidak ditemukan atau statusnya nonaktif.", { show_alert: true }).catch(() => { })
            }
            await ctx.answerCbQuery().catch(() => { });

            // 2. Simpan konteks aksi ke ctx.session
            ctx.session.adminAction = "waiting_stock_input";
            // console.log(ctx.session.adminAction) ////////////////////////////////
            ctx.session.stockContext = {
                productId: product.id,
                productName: product.name,
                messageId: ctx.callbackQuery.message.message_id
            };

            const promptText =
                `📥 <b>ISI STOK: ${product.name} [#${product.id}]</b>\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `Silakan kirimkan data stok (akun, voucher, atau lisensi) di chat ini.\n\n` +
                `📌 <b>Petunjuk Format:</b>\n` +
                `• Gunakan <b>Enter (Baris Baru)</b> untuk memasukkan banyak stok sekaligus.\n` +
                `• Contoh:\n` +
                `<blockquote><code>user1@mail.com:pass123\n` +
                `user2@mail.com:pass456\n` +
                `user3@mail.com:pass789</code></blockquote>\n\n` +
                `<i>Klik tombol di bawah untuk membatalkan proses.</i>`;

            await ctx.editMessageText(promptText, {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("❌ Batal", "stok_tambah")]
                ])
            });
        } catch (err) {
            console.log("[ERROR] Gagal proses stok tambah", err.message);
        }
    });

    bot.action("stok_hapus", async (ctx) => {
        try {
            await ctx.answerCbQuery().catch(() => { });
            const page = ctx.session?.stokHapusPage || 0;
            await renderStokProdukList(ctx, 'hapus', page);
        } catch (err) {
            console.error("[ERROR] Gagal membuka stok hapus:", err.message);
        }
    });

    bot.action(/^stokHapusPage:(\d+)$/, async (ctx) => {
        try {
            await ctx.answerCbQuery().catch(() => { });
            const targetPage = parseInt(ctx.match[1], 10);
            await renderStokProdukList(ctx, 'hapus', targetPage);
        } catch (err) {
            console.error("[ERROR] Gagal navigasi stok hapus page:", err.message);
        }
    });

    bot.action(/^process_stok_hapus:(\d+)$/, async (ctx) => {
        const productId = ctx.match[1];

        try {
            // Ambil data produk & jumlah stok yang tersedia
            const result = await pool.query(
                "SELECT p.id, p.name, COUNT(s.id) AS stock_count " +
                "FROM products p " +
                "LEFT JOIN stocks s ON p.id = s.product_id AND s.status = 'available' " +
                "WHERE p.id = $1 " +
                "GROUP BY p.id, p.name",
                [productId]
            );

            if (result.rows.length === 0) {
                return await ctx.answerCbQuery("⚠️ Produk tidak ditemukan.", { show_alert: true }).catch(() => { })
            }

            const product = result.rows[0]
            if (product.stock_count == 0) {
                return await ctx.answerCbQuery("Stok produk kosong.", { show_alert: true }).catch(() => { })
            }

            await ctx.answerCbQuery().catch(() => { });

            const textConfirm =
                "⚠️ <b>KONFIRMASI HAPUS STOK</b>\n" +
                "━━━━━━━━━━━━━━━━━━━━\n" +
                "📦 <b>Produk:</b> " + product.name + " [ID: #" + product.id + "]\n" +
                "📊 <b>Stok Tersedia:</b> " + product.stock_count + " item\n" +
                "━━━━━━━━━━━━━━━━━━━━\n" +
                "<i>Apakah Anda yakin ingin menghapus <b>SELURUH</b> stok yang tersedia untuk produk ini?</i>";

            await ctx.editMessageText(textConfirm, {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([
                    [
                        Markup.button.callback("❌ Batal", "stok_hapus"),
                        Markup.button.callback("✅ Ya", `confirm_stok_hapus:${productId}`)
                    ]
                ])
            });
        } catch (err) {
            console.log("Gagal menampilkan konfirmasi hapus stok:", err.message);
        }
    });

    bot.action(/^confirm_stok_hapus:(\d+)$/, async (ctx) => {
        const productId = ctx.match[1]

        try {
            const productResult = await pool.query(
                "SELECT id, name FROM products WHERE id = $1",
                [productId]
            );

            if (productResult.rows.length === 0) {
                return await ctx.answerCbQuery("⚠️ Produk tidak ditemukan.", { show_alert: true }).catch(() => { })
            }
            await ctx.answerCbQuery().catch(() => { });

            const product = productResult.rows[0];

            const pendingProduct = await checkProdukPending(product.id)
            const totalProduct = await checkStokAvailable(product.id)
            const productDihapus = totalProduct - pendingProduct

            // Eksekusi Hapus
            const deleteResult = await pool.query(`
                DELETE FROM stocks 
                WHERE id IN (
                    SELECT id 
                    FROM stocks 
                    WHERE product_id = $1 AND status = 'available' 
                    LIMIT $2
                )
            `, [productId, productDihapus]);

            const textSuccess =
                "🗑️ <b>STOK BERHASIL DIHAPUS</b>\n" +
                "━━━━━━━━━━━━━━━━━━━━\n" +
                "📦 <b>Produk:</b> " + product.name + " [ID: #" + product.id + "]\n" +
                "🗑️ <b>Jumlah Dihapus:</b> " + deleteResult.rowCount + "/" + totalProduct + " item\n" +
                "━━━━━━━━━━━━━━━━━━━━\n" +
                "<i>Seluruh stok berstatus 'available' dikurangi quantity yang sudah direservasi user telah dibersihkan.</i>";

            await ctx.editMessageText(textSuccess, {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("⬅️ Kembali", "stok_hapus")]
                ])
            });

        } catch (err) {
            console.log("Gagal mengeksekusi hapus stok:", err.message);
        }
    });

    bot.action("stok_ambil", async (ctx) => {
        try {
            await ctx.answerCbQuery().catch(() => { });
            const page = ctx.session?.stokAmbilPage || 0;
            await renderStokProdukList(ctx, 'ambil', page);
        } catch (err) {
            console.error("[ERROR] Gagal membuka stok ambil:", err.message);
        }
    });

    bot.action(/^stokAmbilPage:(\d+)$/, async (ctx) => {
        try {
            await ctx.answerCbQuery().catch(() => { });
            const targetPage = parseInt(ctx.match[1], 10);
            await renderStokProdukList(ctx, 'ambil', targetPage);
        } catch (err) {
            console.error("[ERROR] Gagal navigasi stok ambil page:", err.message);
        }
    });

    bot.action(/^process_stok_ambil:(\d+)$/, async (ctx) => {
        const productId = ctx.match[1];

        try {

            // 1. Ambil detail produk
            const productResult = await pool.query(
                "SELECT id, name, price FROM products WHERE id = $1",
                [productId]
            );

            if (productResult.rows.length === 0) {
                return await ctx.answerCbQuery("⚠️ Produk tidak ditemukan.", { show_alert: true }).catch(() => { })
            }

            await ctx.answerCbQuery().catch(() => { });

            const product = productResult.rows[0];

            const pendingProduct = await checkProdukPending(product.id)
            const totalProduct = await checkStokAvailable(product.id)
            const productDiambil = totalProduct - pendingProduct

            // 2. Ambil seluruh data stok yang berstatus 'available'
            const stockResult = await pool.query(
                "SELECT id, account_data FROM stocks WHERE product_id = $1 AND status = 'available' ORDER BY id ASC LIMIT $2",
                [productId, productDiambil]
            );

            const stocks = stockResult.rows;

            if (stocks.length === 0) {
                const textEmpty =
                    "📤 <b>DATA STOK PRODUK</b>\n" +
                    "━━━━━━━━━━━━━━━━━━━━\n" +
                    "📦 <b>Produk:</b> " + product.name + " [ID: #" + product.id + "]\n" +
                    "━━━━━━━━━━━━━━━━━━━━\n" +
                    "⚠️ <i>Tidak ada stok yang tersedia saat ini.</i>";

                return await ctx.editMessageText(textEmpty, {
                    parse_mode: "HTML",
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback("⬅️ Kembali", "stok_ambil")]
                    ])
                });
            }

            // 3. Format header informasi
            let textResult =
                "📤 <b>DATA STOK PRODUK</b>\n" +
                "━━━━━━━━━━━━━━━━━━━━\n" +
                "📦 <b>Produk:</b> " + product.name + " [ID: #" + product.id + "]\n" +
                "📊 <b>Total Tersedia:</b> " + `<code>${stocks.length}</code>` + " item\n" +
                "📜 <b>Text broadcast:</b>\n" +
                `- <code>${product.name} (+${stocks.length})</code>\n` +
                `- <code>${product.name} (Rp. ${Number(product.price).toLocaleString("id-ID")})</code>\n` +
                "━━━━━━━━━━━━━━━━━━━━\n\n";

            // 4. Gabungkan isi stok ke dalam bentuk list / code block
            const stockListText = stocks.map((s, index) => (index + 1) + ". " + s.account_data).join("\n");

            textResult +=
                "<code>" + stockListText + "</code>\n\n" +
                "━━━━━━━━━━━━━━━━━━━━\n" +
                "<i>Data stok di atas dapat disalin langsung. Data tersebut dikurangi dengan jumlah quantity yang sedang direservasi user</i>";

            await ctx.editMessageText(textResult, {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("⬅️ Kembali", "stok_ambil")]
                ])
            });

        } catch (err) {
            console.log("Gagal mengambil data stok:", err.message);
        }
    });

    // ================= ADMIN INPUT HANDLER =================
    bot.on("text", async (ctx, next) => {
        try {
            // Kalau tidak sedang menjalankan aksi admin,
            // lanjutkan ke handler berikutnya
            // misal kita ketik angka atu teks apapun maka akan return next kalau adminAction nya undifined
            if (!ctx.session || !ctx.session.adminAction) { // nilainya undefined kalau kita nggak klik tambah
                return next()
            }

            // ================= TAMBAH PRODUK =================
            if (ctx.session.adminAction === "add_product_name") {
                const productName = ctx.message.text.trim();

                if (!productName) {
                    return await ctx.reply("Nama produk tidak boleh kosong.")
                }

                ctx.session.productName = productName
                ctx.session.adminAction = "add_product_price"
                // console.log(ctx.session.adminAction) /////////////////////////////////////////////////

                return await ctx.reply(`➕ <b>TAMBAH PRODUK</b>\n━━━━━━━━━━━━━━━━━━━━\nSilakan masukkan <b>Harga Produk</b> yang ingin ditambahkan:\n\n💡 Contoh: <code>10000</code>`, {
                    parse_mode: 'HTML',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback("❌ Batal", "kelolaProduk")]
                    ])
                })
            }

            // ================= INPUT HARGA =================
            if (ctx.session.adminAction === "add_product_price") {
                const price = Number(ctx.message.text.trim());

                if (!Number.isInteger(price) || price <= 0) {
                    return await ctx.reply("Harga tidak valid. Contoh: 10000")
                }

                ctx.session.productPrice = price;
                ctx.session.adminAction = "add_product_description"
                // console.log(ctx.session.adminAction) /////////////////////////////////////////////////

                return await ctx.reply(`➕ <b>TAMBAH PRODUK</b>\n━━━━━━━━━━━━━━━━━━━━\nSilakan masukkan <b>Deskripsi Produk</b> yang ingin ditambahkan:\n\n<i>Ketik '-' jika tidak ingin menambahkan deskripsi.</i>`, {
                    parse_mode: 'HTML',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback("❌ Batal", "kelolaProduk")]
                    ])
                })
            }

            // ================= DESKRIPSI PRODUK =================
            if (ctx.session.adminAction === "add_product_description") {
                const inputDesc = ctx.message.text.trim()
                const descText = inputDesc === "-" ? null : inputDesc

                ctx.session.productDescription = descText;
                ctx.session.adminAction = "add_product_note";
                // console.log(ctx.session.adminAction) /////////////////////////////////////////////////

                return await ctx.reply(`➕ <b>TAMBAH PRODUK</b>\n━━━━━━━━━━━━━━━━━━━━\nSilakan masukkan <b>Catatan</b> yang ingin ditambahkan:\n\n💡 Contoh: <code>Format login atau video tutorial</code>`, {
                    parse_mode: 'HTML',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback("❌ Batal", "kelolaProduk")]
                    ])
                })
            }

            // ================= Note PRODUK =================
            if (ctx.session.adminAction === "add_product_note") {
                const inputNote = ctx.message.text.trim()
                const noteText = inputNote === "-" ? null : inputNote

                ctx.session.productNote = noteText;
                ctx.session.adminAction = "add_product_confirm";
                // console.log(ctx.session.adminAction) /////////////////////////////////////////////////

                const textKonfirm = `📝 <b>KONFIRMASI TAMBAH PRODUK</b>\n━━━━━━━━━━━━━━━━━━━━\n📦 <b>Nama:</b> ${ctx.session.productName}\n💰 <b>Harga:</b> Rp ${ctx.session.productPrice.toLocaleString("id-ID")}\n📄 <b>Deskripsi:</b> ${ctx.session.productDescription || "<i>Tidak ada</i>"}\n📌 <b>Catatan:</b> ${ctx.session.productNote || "<i>Tidak ada</i>"}\n\nApakah Anda yakin ingin menambahkan produk ini?`

                return await ctx.reply(textKonfirm, {
                    parse_mode: 'HTML',
                    ...Markup.inlineKeyboard([
                        [
                            Markup.button.callback("✅ Ya", "konfirmasiTambahProduk_ya"),
                            Markup.button.callback("❌ Tidak", "konfirmasiTambahProduk_tidak")
                        ]
                    ])
                })
            }

            // ================= EDIT PRODUK =================
            if (ctx.session.adminAction === "waiting_product_update") {
                const input = ctx.message.text.trim()
                const { productId, field, messageId } = ctx.session.editContext

                let finalValue = input;

                // 3. Validasi khusus jika field berupa 'price' (Harga)
                if (field === "price") {
                    const parsedPrice = parseInt(input.replace(/[^0-9]/g, ""), 10);
                    if (isNaN(parsedPrice) || parsedPrice < 0) {
                        return await ctx.reply("Harga tidak valid. Contoh: 10000")
                    }
                    finalValue = parsedPrice;
                } else if (field === "description" || field === "note") {
                    finalValue = input.trim() === "-" ? null : input.trim();
                }

                try {
                    // 4. Update data ke database PostgreSQL secara dinamis
                    const result = await pool.query(`
                        UPDATE products 
                        SET ${field} = $1
                        WHERE id = $2 
                        RETURNING *
                    `, [finalValue, productId]);

                    if (result.rowCount === 0) {
                        await ctx.reply("❌ Gagal memperbarui: Produk tidak ditemukan di database.");
                    } else {
                        // Kirim notifikasi sukses
                        await ctx.reply(`✅ Berhasil memperbarui <b>${field.toUpperCase()}</b> produk #${productId}!`,
                            {
                                parse_mode: "HTML",
                                ...Markup.inlineKeyboard([
                                    [Markup.button.callback("⬅️ Kembali ke Edit Produk", `editProduk:${productId}`)]
                                ])
                            });
                    }

                    // 5. Bersihkan state session
                    ctx.session.adminAction = null;
                    ctx.session.editContext = null;
                } catch (err) {
                    console.error("[ERROR] Gagal memperbarui database", err.message);
                }
            }

            if (ctx.session.adminAction === "waiting_stock_input") {
                const input = ctx.message.text.trim();
                const { productId, productName } = ctx.session.stockContext;

                // 2. Memecah input teks menjadi baris-baris stok
                const items = input
                    .split("\n")
                    .map(item => item.trim())
                    .filter(item => item.length > 0);

                if (items.length === 0) {
                    return await ctx.reply("Format teks tidak valid. Masukkan minimal 1 baris stok.")
                }

                try {
                    // 3. Susun query Bulk Insert PostgreSQL
                    const values = [];
                    const valuePlaceholders = [];

                    items.forEach((item, index) => {
                        const p1 = index * 2 + 1;
                        const p2 = index * 2 + 2;
                        valuePlaceholders.push(`($${p1}, $${p2}, 'available')`);
                        values.push(productId, item);
                    });

                    const insertQuery = `
                        INSERT INTO stocks (product_id, account_data, status) 
                        VALUES ${valuePlaceholders.join(", ")}
                    `;

                    await pool.query(insertQuery, values);

                    // 4. Bersihkan state session
                    ctx.session.adminAction = null;
                    ctx.session.stockContext = null;

                    // 5. Kirim notifikasi sukses
                    await ctx.reply(
                        `✅ <b>BERHASIL MENAMBAH STOK</b>\n` +
                        `━━━━━━━━━━━━━━━━━━━━\n` +
                        `📦 <b>Produk:</b> ${productName} [ID: #${productId}]\n` +
                        `📥 <b>Jumlah Stok Diterima:</b> <code>+${items.length} item</code>`,
                        {
                            parse_mode: "HTML",
                            ...Markup.inlineKeyboard([
                                [Markup.button.callback("⬅️ Kembali ke Kelola Stok", "kelolaStok")]
                            ])
                        }
                    );
                } catch (err) {
                    console.error("[ERROR] Gagal menambah stok produj", err.message);
                }
            }
            if (ctx.session.adminAction === "WAITING_SEARCH_ORDER_INPUT") {
                const input = ctx.message.text.trim();
                ctx.session.adminAction = null; // Reset state

                if (!input) {
                    return ctx.reply("❌ Input tidak boleh kosong.");
                }

                await processOrderSearch(ctx, input);
            }

            if (ctx.session.adminAction === "waiting_broadcast_text") {
                const broadcastContent = ctx.message.text;

                // Hitung total penerima (hanya pengguna Telegram asli)
                const countRes = await pool.query("SELECT COUNT(id) AS total FROM users WHERE telegram_id > 0");
                const totalUsers = countRes.rows[0].total || 0;

                ctx.session.broadcastContent = broadcastContent;
                delete ctx.session.adminAction

                const textConfirm =
                    "⚠️ <b>KONFIRMASI BROADCAST</b>\n" +
                    "━━━━━━━━━━━━━━━━━━━━\n" +
                    "🎯 <b>Target Penerima:</b> " + totalUsers + " pengguna\n" +
                    "━━━━━━━━━━━━━━━━━━━━\n" +
                    "📝 <b>PREVIEW PESAN:</b>\n\n" + "<code>" +
                    broadcastContent + "</code>\n\n" +
                    "━━━━━━━━━━━━━━━━━━━━\n" +
                    "<i>Apakah Anda yakin ingin mengirimkan pesan di atas?</i>";

                return await ctx.reply(textConfirm, {
                    parse_mode: "HTML",
                    ...Markup.inlineKeyboard([
                        [
                            Markup.button.callback("❌ Batal", "broadcast"),
                            Markup.button.callback("🚀 Kirim Sekarang", "broadcast_execute")
                        ]
                    ])
                });
            }

            return next();
        } catch (err) {
            console.log("[ERROR] Gagal mengambil teks", err.message)
        }
    })

    bot.action(["admin_stats", "refresh_stats"], async (ctx) => {
        try {
            await ctx.answerCbQuery().catch(() => { });

            // 1. Query Statistik Keseluruhan (All-Time) & Master Data
            const allTimeQuery = await pool.query(`
                SELECT 
                    (SELECT COUNT(*) FROM users) AS total_user,
                    (SELECT COUNT(*) FROM products) AS total_produk,
                    (SELECT COUNT(*) FROM stocks WHERE status = 'available') AS stok_ready,
                    (SELECT COUNT(*) FROM orders WHERE status = 'pending') AS pending_orders,
                    COALESCE(SUM(quantity), 0) AS total_terjual,
                    COALESCE(SUM(total), 0) AS total_pendapatan,
                    COUNT(id) AS total_transaksi
                FROM orders
                WHERE status IN ('paid', 'completed')
            `);

            // 2. Query Statistik Khusus Hari Ini
            const todayQuery = await pool.query(`
                SELECT 
                    COUNT(id) AS total_paid,
                    COALESCE(SUM(quantity), 0) AS terjual_today,
                    COALESCE(SUM(total), 0) AS total_revenue
                FROM orders
                WHERE status IN ('paid', 'completed') 
                AND created_at::date = CURRENT_DATE
            `);

            const allTime = allTimeQuery.rows[0];
            const today = todayQuery.rows[0];

            const totalUser = parseInt(allTime.total_user, 10) || 0;
            const totalProduk = parseInt(allTime.total_produk, 10) || 0;
            const stokAvailable = parseInt(allTime.stok_ready, 10) || 0;
            const pendingOrder = parseInt(allTime.pending_orders, 10) || 0;

            const totalTerjual = parseInt(allTime.total_terjual, 10) || 0;
            const totalTransaksi = parseInt(allTime.total_transaksi, 10) || 0;
            const totalPendapatan = parseInt(allTime.total_pendapatan, 10) || 0;
            const totalPendapatanFormatted = totalPendapatan.toLocaleString("id-ID");

            const paidToday = parseInt(today.total_paid, 10) || 0;
            const terjualToday = parseInt(today.terjual_today, 10) || 0;
            const revenueToday = parseInt(today.total_revenue, 10) || 0;
            const revenueTodayFormatted = revenueToday.toLocaleString("id-ID");

            // Format Waktu WIB (Waktu Indonesia Barat)
            const waktuWib = new Date().toLocaleTimeString("id-ID", {
                timeZone: "Asia/Jakarta",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit"
            }).replace(/\./g, ".");

            // 3. Format Pesan Teks
            const textStatistik =
                "╭──────────────────\n" +
                "│ 📊 <b>STATISTIK BOT</b>\n" +
                "├──────────────────\n" +
                "│ 👥 <b>Total User:</b> " + totalUser + " pengguna\n" +
                "│ 📦 <b>Total Produk:</b> " + totalProduk + " jenis\n" +
                "│ 🟢 <b>Stok Ready:</b> " + stokAvailable + " item\n" +
                "├──────────────────\n" +
                "│ 🛍️ <b>Total Terjual:</b> " + totalTerjual + " pcs\n" +
                "│ 💳 <b>Total Transaksi:</b> " + totalTransaksi + " sukses\n" +
                "│ 💎 <b>Total Pendapatan:</b> Rp " + totalPendapatanFormatted + "\n" +
                "├──────────────────\n" +
                "│ ⏳ <b>Pesanan Pending:</b> " + pendingOrder + " transaksi\n" +
                "│ ✅ <b>Lunas Hari Ini:</b> " + paidToday + " transaksi (" + terjualToday + " pcs)\n" +
                "│ 💰 <b>Omset Hari Ini:</b> Rp " + revenueTodayFormatted + "\n" +
                "├──────────────────\n" +
                "│ ⏰ <b>Pembaruan:</b> " + waktuWib + " WIB\n" +
                "╰──────────────────\n\n" +
                "💡 <i>Data diperbarui secara realtime dari database.</i>";

            // 4. Render Tampilan & Inline Keyboard
            const keyboard = Markup.inlineKeyboard([
                [
                    Markup.button.callback("🔄 Refresh Data", "refresh_stats"),
                    Markup.button.callback("⬅️ Kembali", "back_to_admin")
                ]
            ]);

            if (ctx.callbackQuery && ctx.callbackQuery.message) {
                await ctx.editMessageText(textStatistik, {
                    parse_mode: "HTML",
                    ...keyboard
                }).catch(async () => {
                    // Jika konten pesan tidak berubah saat di-refresh, cegah error Telegram API
                });
            } else {
                await ctx.reply(textStatistik, {
                    parse_mode: "HTML",
                    ...keyboard
                });
            }
        } catch (err) {
            console.log("Gagal memuat statistik admin:", err.message);
            await ctx.reply("❌ Terjadi kesalahan saat memuat statistik.").catch(() => { });
        }
    });

    bot.action("admin_top_terlaris", async (ctx) => {
        try {
            await ctx.answerCbQuery().catch(() => { });

            const query = `
                SELECT 
                    p.id,
                    p.name,
                    p.price,
                    p.active,
                    COALESCE(SUM(o.quantity), 0) AS total_terjual,
                    COALESCE(SUM(o.total), 0) AS total_omset,
                    (SELECT COUNT(*) FROM stocks s WHERE s.product_id = p.id AND s.status = 'available') AS stok_tersedia,
                    (SELECT COALESCE(SUM(o2.quantity), 0) FROM orders o2 
                     WHERE o2.product_id = p.id 
                     AND o2.status = 'pending' 
                     AND (o2.expires_at > NOW() OR o2.expires_at IS NULL)) AS stok_pending
                FROM products p
                LEFT JOIN orders o ON p.id = o.product_id AND o.status = 'completed'
                WHERE p.active = TRUE
                GROUP BY p.id, p.name, p.price, p.active
                ORDER BY total_terjual DESC, p.id ASC
                LIMIT 3
            `;

            const result = await pool.query(query);

            if (result.rows.length === 0) {
                return await ctx.editMessageText("📦 <b>PRODUK TERLARIS</b>\n━━━━━━━━━━━━━━━━━━━━\nBelum ada produk aktif yang terdaftar di database.", {
                    parse_mode: "HTML",
                    ...Markup.inlineKeyboard([[Markup.button.callback("⬅️ Kembali", "back_to_admin")]])
                });
            }

            const medals = ['🥇', '🥈', '🥉'];
            const lines = [
                "╭──────────────────",
                "│ 🔥 <b>PRODUK TERLARIS (TOP 3)</b>",
                "├──────────────────"
            ];

            result.rows.forEach((p, idx) => {
                const medal = medals[idx] || `[${idx + 1}]`;
                const stokAvail = parseInt(p.stok_tersedia, 10) || 0;
                const stokPend = parseInt(p.stok_pending, 10) || 0;
                const sisaStok = Math.max(0, stokAvail - stokPend);
                const omset = Number(p.total_omset || 0).toLocaleString("id-ID");
                const status = p.active ? "✅ Aktif" : "❌ Nonaktif";

                lines.push(`│ ${medal} <b>[${idx + 1}] ${p.name.toUpperCase()}</b>`);
                lines.push(`│ ⬩ Terjual: ${p.total_terjual} pcs`);
                lines.push(`│ ⬩ Total Omset: Rp ${omset}`);
                lines.push(`│ ⬩ Sisa Stok: ${sisaStok} item`);
                lines.push(`│ ⬩ Status: ${status}`);
                if (idx < result.rows.length - 1) {
                    lines.push("├──────────────────");
                }
            });

            lines.push("╰──────────────────\n");
            lines.push("💡 <i>Dihitung berdasarkan pesanan yang berstatus sukses (completed).</i>");

            await ctx.editMessageText(lines.join('\n'), {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("⬅️ Kembali", "back_to_admin")]
                ])
            });
        } catch (err) {
            console.error("Gagal memuat top terlaris admin:", err.message);
            await ctx.reply("❌ Terjadi kesalahan saat memuat data produk terlaris.").catch(() => { });
        }
    });

    // 1. Trigger saat Admin menekan tombol "Cari Order"
    bot.action("admin_search_order", async (ctx) => {
        try {
            await ctx.answerCbQuery().catch(() => { });

            ctx.session.adminAction = "WAITING_SEARCH_ORDER_INPUT";
            console.log(ctx.session.adminAction)

            const textPrompt =
                "🔍 <b>CARI ORDERAN</b>\n" +
                "━━━━━━━━━━━━━━━━━━━━\n" +
                "Mau cari orderan yang mana, min? Kirimkan salah satu info ini ya:\n\n" +
                "🔹 <b>ID Order / Kode Ref</b> (contoh: <code>15</code> / <code>DEP212392</code>)\n" +
                "🔹 <b>User ID Pembeli</b> (contoh: <code>123456789</code>)\n" +
                "🔹 <b>Username Pembeli</b> (contoh: <code>@vhee_user</code>)"

            await ctx.editMessageText(textPrompt, {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("❌ Batal", "back_to_admin")]
                ])
            });
        } catch (err) {
            console.error("Error trigger search order:", err.message);
        }
    });

    async function processOrderSearch(ctx, keyword) {
        try {
            // Pembersihan input
            let cleanKeyword = keyword.trim();
            if (cleanKeyword.startsWith("@") && !cleanKeyword.includes(".")) {
                cleanKeyword = cleanKeyword.slice(1);
            }
            const isNumeric = /^\d+$/.test(cleanKeyword);

            let whereCondition = "";
            let queryValue = cleanKeyword;

            if (isNumeric) {
                // Jika berupa angka, cari berdasarkan:
                // 1. ID Order (o.id)
                // 2. ATAU ID Database User (o.user_id)
                // 3. ATAU Telegram ID User (u.telegram_id)
                whereCondition = "(o.id = $1 OR o.user_id = $1 OR u.telegram_id = $1)";
                queryValue = parseInt(cleanKeyword, 10);
            } else if (cleanKeyword.toUpperCase().startsWith("DEP") || cleanKeyword.includes("_") || cleanKeyword.includes("-")) {
                // Jika format payment reference (seperti DEP212392)
                whereCondition = "LOWER(o.payment_reference) = LOWER($1)";
            } else {
                // Jika teks/username/email
                whereCondition = "LOWER(u.username) = LOWER($1)";
            }

            const searchQuery =
                "SELECT " +
                "   o.id AS order_id, o.user_id, o.quantity, o.amount, o.total, o.status, o.created_at, o.data AS sent_data, o.payment_reference, " +
                "   p.name AS product_name, p.price AS product_price, " +
                "   u.username, u.first_name, u.telegram_id " +
                "FROM orders o " +
                "LEFT JOIN products p ON o.product_id = p.id " +
                "LEFT JOIN users u ON o.user_id = u.id " + // JOIN relasi DB: o.user_id -> u.id
                "WHERE " + whereCondition + " " +
                "ORDER BY o.id DESC " +
                "LIMIT 5";

            const result = await pool.query(searchQuery, [queryValue]);

            if (result.rows.length === 0) {
                return ctx.reply("❌ Tidak ditemukan transaksi untuk kata kunci: <b>" + keyword + "</b>", { parse_mode: "HTML" });
            }

            // Jika pencarian tepat menghasilkan 1 data
            if (result.rows.length === 1) {
                return await renderSingleOrderDetail(ctx, result.rows[0]);
            }

            // Jika ada beberapa order dari user/username yang sama
            let listText = "🔎 <b>HASIL PENCARIAN ORDER</b> (" + result.rows.length + " Terbaru)\n" +
                "Kata kunci: <code>" + keyword + "</code>\n\n";

            const buttons = [];

            result.rows.forEach((order) => {
                const createdAt = new Date(order.created_at).toLocaleDateString("id-ID", {
                    timeZone: "Asia/Jakarta",
                    day: "2-digit",
                    month: "2-digit"
                });

                let statusIcon = "⏳";
                if (order.status === "completed" || order.status === "paid") statusIcon = "✅";
                if (order.status === "cancelled") statusIcon = "🚫";
                if (order.status === "expired") statusIcon = "❌";
                if (order.status === "refunded") statusIcon = "🔄";

                const displayTotal = order.total ? Number(order.total) : Number(order.amount);
                listText += statusIcon + " <b># " + order.order_id + "</b> | " + order.product_name + " | Rp " + displayTotal.toLocaleString("id-ID") + " (" + createdAt + ")\n";

                buttons.push([
                    Markup.button.callback("📦 Detail Order #" + order.order_id, "view_order_" + order.order_id)
                ]);
            });

            buttons.push([
                Markup.button.callback("🔎 Cari Lagi", "admin_search_order"),
                Markup.button.callback("⬅️ Kembali", "back_to_admin")
            ]);

            await ctx.reply(listText, {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard(buttons)
            });

        } catch (err) {
            console.error("Gagal memproses pencarian order:", err.message);
        }
    }

    // 5. Helper Function untuk Format Tampilan Single Order
    async function renderSingleOrderDetail(ctx, order, isEdit = false) {
        const createdAt = new Date(order.created_at).toLocaleString("id-ID", {
            timeZone: "Asia/Jakarta",
            dateStyle: "medium",
            timeStyle: "medium"
        });

        let statusBadge = "⏳ MENUNGGU PAYMENT";
        if (order.status === "completed") statusBadge = "✅ SUKSES";
        if (order.status === "paid") statusBadge = "✅ TERBAYAR (MEMPROSES)";
        if (order.status === "cancelled") statusBadge = "🚫 DIBATALKAN";
        if (order.status === "expired") statusBadge = "❌ KADALUARSA";

        const totalPayable = order.total ? Number(order.total) : Number(order.amount);
        const baseAmount = Number(order.amount || (order.product_price ? Number(order.product_price) * Number(order.quantity) : totalPayable));
        const fee = Math.max(0, totalPayable - baseAmount);

        const buyerName = order.first_name || "User";
        const buyerUsername = order.username ? "@" + order.username : "-";
        const stockData = order.sent_data ? order.sent_data : "<i>(Tidak ada data stok)</i>";

        const textDetail =
            "╭──────────────────\n" +
            "│ 📦 <b>DETAIL ORDER #" + order.order_id + "</b>\n" +
            "├──────────────────\n" +
            "│ 🧾 <b>Reff ID:</b> <code>" + order.payment_reference + "</code>\n" +
            "│ 📑 <b>Status:</b> " + statusBadge + "\n" +
            "│ 👤 <b>Pembeli:</b> " + buyerName + " (" + buyerUsername + ")\n" +
            "│ 🆔 <b>User ID:</b> <code>" + order.user_id + "</code>\n" +
            "├──────────────────\n" +
            "│ 🛒 <b>Produk:</b> " + order.product_name + "\n" +
            "│ 🔢 <b>Jumlah:</b> " + order.quantity + "\n" +
            "│ 🏷️ <b>Fee:</b> Rp " + fee.toLocaleString("id-ID") + "\n" +
            "│ 💰 <b>Total Bayar:</b> Rp " + totalPayable.toLocaleString("id-ID") + "\n" +
            "│ ⏰ <b>Waktu:</b> " + createdAt + " WIB\n" +
            "├──────────────────\n" +
            "│ 🔑 <b>Data Produk / Stok:</b>\n" +
            "│ <code>" + stockData + "</code>\n" +
            "╰──────────────────";

        const actionButtons = [];

        actionButtons.push([
            Markup.button.callback("🔎 Cari Order Lain", "admin_search_order"),
            Markup.button.callback("⬅️ Kembali", "back_to_admin")
        ]);

        const keyboard = Markup.inlineKeyboard(actionButtons);

        if (isEdit && ctx.callbackQuery) {
            await ctx.editMessageText(textDetail, { parse_mode: "HTML", ...keyboard }).catch(() => { });
        } else {
            await ctx.reply(textDetail, { parse_mode: "HTML", ...keyboard });
        }
    }

    bot.action(/^view_order_(\d+)$/, async (ctx) => {
        try {
            await ctx.answerCbQuery().catch(() => { });
            const orderId = ctx.match[1];

            const query =
                "SELECT " +
                "   o.id AS order_id, o.user_id, o.quantity, o.amount, o.total, o.status, o.created_at, o.data AS sent_data, o.payment_reference, " +
                "   p.name AS product_name, p.price AS product_price, " +
                "   u.username, u.first_name, u.telegram_id " +
                "FROM orders o " +
                "LEFT JOIN products p ON o.product_id = p.id " +
                "LEFT JOIN users u ON o.user_id = u.id " + // JOIN relasi DB: o.user_id -> u.id
                "WHERE o.id = $1";

            const result = await pool.query(query, [orderId]);
            if (result.rows.length > 0) {
                await renderSingleOrderDetail(ctx, result.rows[0], true);
            }
        } catch (err) {
            console.error("Gagal menampilkan detail order callback:", err.message);
        }
    });
}

export { adminSetup }